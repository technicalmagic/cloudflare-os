// DOWNSTREAM (fabric): who a Web Search account belongs to. Covers PATCH-ID fabric-account-owner.
//
// The Workshop names the user it mints an account for (GatekeeperVendor.createAccount's `owner`).
// The account keeps that principal in its props, hands it to the gatekeeper class it gives out, and
// each search sends it, so whatever answers env.AI.websearch() can charge that user. An account with
// no owner, because it was minted before this patch or by a call that named none, carries nothing,
// and is minted and searches exactly as upstream's does.

/** The props a Web Search account, and the gatekeeper class it hands out, carry. */
export type WebSearchOwner = {
  /** The owner's principal, as the Workshop named it at mint. Absent on an account with no owner. */
  principal?: string;
};

/**
 * The owner to mint an account with, from createAccount's argument as it arrives over RPC. That
 * method skips capnweb-validate, so the argument is unchecked: no argument is no owner, and anything
 * other than `{principal: <a non-empty string>}` is refused, so a malformed owner is never minted.
 */
export function ownerFrom(owner: unknown): WebSearchOwner {
  if (owner === undefined) return {};
  if (typeof owner === "object" && owner !== null && "principal" in owner &&
      typeof owner.principal === "string" && owner.principal.length > 0) {
    return { principal: owner.principal };
  }
  throw new TypeError("An account's owner must be {principal: string}.");
}

/**
 * The options for `ctx.exports.WebSearchAccount()` or `ctx.exports.WebSearchGatekeeper()`: the owner
 * as props, or upstream's `{}` when there is none.
 */
export function withOwner(owner: WebSearchOwner | undefined): { props?: WebSearchOwner } {
  return owner?.principal === undefined ? {} : { props: { principal: owner.principal } };
}
