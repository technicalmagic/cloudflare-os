// DOWNSTREAM (fabric): the Workshop names an auto-provisioned account's owner. Covers PATCH-ID
// fabric-account-owner.
//
// Chris decided on 2026-10-20 that a tool's use is charged to the workspace owner. Upstream mints an
// auto-provisioned account with GatekeeperVendor.createAccount() and no arguments, so a vendor can
// never learn whose account it minted, and nothing it sends can name who should pay. The patch passes
// {principal} -- the identity string the user's Durable Object is named by -- on both minting paths,
// and upstream's argument-less call before the user's account exists.

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { UserDurableObject } from "../src/user.js";
import { ADMIN_CONFIG_KEY } from "../src/storage-schema/blueprints-kv.js";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_USER: DurableObjectNamespace<UserDurableObject>;
  }
}

// What a test reaches into on the user's DO: the env (for the admin config), ctx.exports (for a
// storable account stub), the vendor map, and the accounts it persisted.
type UserInternals = UserDurableObject & {
  env: Cloudflare.Env;
  ctx: DurableObjectState & { exports: Record<string, (options: unknown) => unknown> };
  vendors: Map<string, unknown>;
  storage: {
    connectedAccounts: { list(): Iterable<{ vendorId: string; autoProvisioned?: boolean }> };
  };
};

type LoginStub = {
  loginOrCreateViaGatekeeper(identity: string, allowCreate: boolean, displayName?: string):
    Promise<string | null>;
};

/** A principal of this distro's shape (a WorkOS user id), unique to the test. */
function newPrincipal(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return `user_${[...bytes].map(byte => alphabet[byte % 32]).join("")}`;
}

/**
 * Run `f` in the user DO named `name`, with Web Search as its only vendor (recording every
 * createAccount call's arguments) and `modes` as the admin's ambient gatekeeper modes.
 */
function withWebSearch<T>(
  name: string,
  modes: Record<string, string>,
  f: (user: UserInternals, minted: unknown[][]) => Promise<T>,
): Promise<T> {
  return runInDurableObject(env.TEST_USER.getByName(name), async (instance: UserDurableObject) => {
    const user = instance as UserInternals;
    const config = JSON.stringify({ ambientGatekeeperModes: modes });
    const BLUEPRINTS = {
      get: async (key: string) => (key === ADMIN_CONFIG_KEY ? config : null),
    } as unknown as KVNamespace;
    user.env = { ...user.env, BLUEPRINTS };

    const minted: unknown[][] = [];
    user.vendors = new Map([["websearch", {
      describe: async () => ({ displayName: "Web Search", autoProvisionsAccount: true }),
      createAccount: async (...args: unknown[]) => {
        minted.push(args);
        return user.ctx.exports.FakeGatekeeperAccount({ props: { name: `${name}-websearch` } });
      },
    }]]);
    return f(user, minted);
  });
}

/** Signs `principal` in through a gatekeeper, as this distro does, into the DO named `name`. */
async function signIn(name: string, principal: string): Promise<void> {
  const stub = env.TEST_USER.getByName(name) as unknown as LoginStub;
  await stub.loginOrCreateViaGatekeeper(principal, true, "Owner");
}

const autoProvisioned = (user: UserInternals) =>
  [...user.storage.connectedAccounts.list()].filter(account => account.autoProvisioned)
    .map(account => account.vendorId);

describe("an auto-provisioned account's owner", () => {
  it("is named when the user adds Web Search", async () => {
    const principal = newPrincipal();
    await signIn(principal, principal);

    await withWebSearch(principal, {}, async (user, minted) => {
      await user.provisionAmbientAccount("websearch");

      expect(minted).toStrictEqual([[{ principal }]]);
      expect(autoProvisioned(user)).toEqual(["websearch"]);
    });
  });

  it("is named when the admin turns Web Search on for everyone", async () => {
    const principal = newPrincipal();
    await signIn(principal, principal);

    await withWebSearch(principal, { websearch: "enabled" }, async (user, minted) => {
      await user.listProvidedAccounts();

      expect(minted).toStrictEqual([[{ principal }]]);
      expect(autoProvisioned(user)).toEqual(["websearch"]);
    });
  });

  it("is the identity the account was created with, not the Durable Object's name", async () => {
    // In production the two are one string (login-flow.ts names the DO with idFromName(identity)),
    // but only the profile survives a cold start through idFromString(), as the Overseer reaches an
    // owner, so the profile is the source the patch reads.
    const principal = newPrincipal();
    const name = `alias-${crypto.randomUUID()}`;
    await signIn(name, principal);

    await withWebSearch(name, {}, async (user, minted) => {
      await user.provisionAmbientAccount("websearch");

      expect(minted).toStrictEqual([[{ principal }]]);
    });
  });

  it("is not named, and the call is upstream's, before the user's account exists", async () => {
    // A never-created profile holds a placeholder id, which must not be sent as an owner.
    const name = `uncreated-${crypto.randomUUID()}`;

    await withWebSearch(name, {}, async (user, minted) => {
      await user.provisionAmbientAccount("websearch");

      expect(minted).toStrictEqual([[]]);
    });
  });

  it("is named once: an account already added is not minted again", async () => {
    const principal = newPrincipal();
    await signIn(principal, principal);

    await withWebSearch(principal, { websearch: "enabled" }, async (user, minted) => {
      await user.provisionAmbientAccount("websearch");
      await user.listProvidedAccounts();
      await user.provisionAmbientAccount("websearch");

      expect(minted).toStrictEqual([[{ principal }]]);
    });
  });
});
