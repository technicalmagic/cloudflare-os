// DOWNSTREAM (fabric): Context cross-domain isolation.
//
// In the silo model each tenant is its own deployment with its own `sharingDomain`. The line that
// keeps one domain's Context collections unreadable from another is a single early return in
// ContextVerifier.hasCollectionsAccess (library-gatekeeper.ts; one id at a time as hasCollectionAccess
// until upstream d420d9bb, #756, batched it):
//
//     if (sharingDomain !== this.ctx.props.sharingDomain) return collectionIds.map(() => false);
//
// Upstream's context-observers.test.ts never reaches it: that suite builds its OWN fake verifier
// (`let api = { async hasCollectionsAccess(...) {...} } as unknown as Fetcher<ContextVerifierApi>`),
// so the real implementation -- and therefore the real domain check -- is untested upstream.
//
// This probe calls the real method, and asserts two things:
//   1. a foreign domain is refused; and
//   2. it is refused WITHOUT consulting storage.
// (2) is what makes the test meaningful. `ctx.exports` here throws on any access, so if the early
// return is ever removed or reordered below the lookups, this test fails loudly rather than
// quietly passing because a Durable Object happened to answer "no".

import { describe, expect, it } from "vitest";
import { ContextVerifier } from "../src/library-gatekeeper.js";

const OWN_DOMAIN = "tenant-a.fabric.test";
const FOREIGN_DOMAIN = "tenant-b.fabric.test";
const COLLECTION_ID = "collection-under-test";

// Any property read is a failure: reaching storage means the domain check did not short-circuit.
const STORAGE_IS_OFF_LIMITS = new Proxy({}, {
  get(_target, property) {
    throw new Error(
      `ContextVerifier consulted storage (ctx.exports.${String(property)}) before rejecting a `
      + `foreign sharingDomain -- the cross-domain early return is gone or has been reordered`);
  },
});

function verifierOwnedBy(sharingDomain: string): ContextVerifier {
  const ctx = { props: { sharingDomain, accountId: "account-a" }, exports: STORAGE_IS_OFF_LIMITS };
  // WorkerEntrypoint's (ctx, env) constructor. env is unused on this path.
  return new ContextVerifier(ctx as never, {} as never);
}

describe("Context cross-domain isolation", () => {
  it("refuses a collection request from a foreign sharingDomain", async () => {
    const verifier = verifierOwnedBy(OWN_DOMAIN);

    await expect(verifier.hasCollectionsAccess(FOREIGN_DOMAIN, [COLLECTION_ID])).resolves.toEqual([false]);
  });

  it("refuses every collection of a batch from a foreign sharingDomain, one answer each", async () => {
    const verifier = verifierOwnedBy(OWN_DOMAIN);

    await expect(verifier.hasCollectionsAccess(FOREIGN_DOMAIN, [COLLECTION_ID, "another", "a-third"]))
      .resolves.toEqual([false, false, false]);
    await expect(verifier.hasCollectionsAccess(FOREIGN_DOMAIN, [])).resolves.toEqual([]);
  });

  it("refuses it without consulting storage", async () => {
    const verifier = verifierOwnedBy(OWN_DOMAIN);

    // Throws via STORAGE_IS_OFF_LIMITS if the early return no longer guards the lookups.
    await expect(verifier.hasCollectionsAccess(FOREIGN_DOMAIN, [COLLECTION_ID])).resolves.toEqual([false]);
  });

  it("does not treat a domain prefix as the same domain", async () => {
    const verifier = verifierOwnedBy(OWN_DOMAIN);

    // Guards against the check ever becoming startsWith/includes rather than strict equality.
    await expect(verifier.hasCollectionsAccess(`${OWN_DOMAIN}.evil.test`, [COLLECTION_ID]))
      .resolves.toEqual([false]);
    await expect(verifier.hasCollectionsAccess(OWN_DOMAIN.slice(0, -1), [COLLECTION_ID]))
      .resolves.toEqual([false]);
  });
});
