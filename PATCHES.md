# Downstream patches

Every commit on `distro` that modifies an upstream file is recorded here and carries a matching
`PATCH-ID` trailer. CI asserts the two agree, and that `git diff --name-only upstream-main...distro`
lists nothing but these files plus new-file-only paths.

**The budget is ten patches. Six are committed: four landed, two planned, four free.** (Raised from
three on 2026-09-17, deliberately: carrying a set of patches is expected of this distro, and the
discipline is to keep each one justified rather than to keep the count artificially small. A patch
earns its place by directly supporting what Fabric offers that upstream does not.)

The count is the cheap half of the rule. Six files cost more than a slot (the gate, `scripts/fabric-patch-ledger.ts`, calls them high-churn and refuses one that a patch's entry does not name on its `**High-churn:**` line): `overseer.ts`, `agent.ts`,
`server.ts`, `ai-models.ts`, `workshop-shared/src/api.ts`, `workshop-frontend/`. A patch landing in
one of them is not forbidden — `fabric-popupless-signin` took two on purpose — but it has to say why
no seam reaches, and it should expect to be re-read on every merge rather than carried unexamined.

What actually keeps this small is per-patch, not per-budget: every entry states what no seam reaches,
what would retire it, and where its tests live (a file of its own, so a patch adds conflict surface
only where its behaviour does). A patch whose `REVIEW-IF` has fired is a patch to re-derive or drop,
not to re-merge.

Both happen in commits, never inside a merge. The gate refuses a merge that changes a patched file
beyond what git merges on its own, so when upstream conflicts with a patch, move the patch's lines
aside in a `PATCH-ID` commit, merge, and restore them in another. To drop a patch, revert it and
change its heading to `RETIRED YYYY-MM-DD`. The entry stays as the record and frees its slot, and the
gate accepts it once none of its files differ from upstream.

Why any of this is strict when the budget is not: upstream refuses outside contributions
(CONTRIBUTING.md) and closed an outside security report unmerged, so every line here is permanent
divergence with no upstream path. Upstream also rewrote 77–83% of its hottest kernel files in a
four-week window, so a patch's cost is not its size but how often the code under it moves — which is
why ten slots is not permission to spend ten.

Each entry states what no seam reaches, because "could this have been a wrapper?" is the question to
re-ask on every merge.

---

## `fabric-entitlements` — NOT YET LANDED

**Files:** `packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts`

**Why no seam:** `checkUsageAndBalance` is a static import in `overseer.ts`; the entitlement source
is hardcoded to the vendor id `"cloudflare"` (`user.ts:93,687`) and `api.cloudflare.com`
(`cloudflare/account-service.ts:12`). No binding, no interface, no env-selected provider.

**Shape:** one guarded early return behind `env.FABRIC_ENTITLEMENTS`, above upstream's untouched
Cloudflare branch. All logic in a new, never-conflicting `src/fabric/entitlements.ts`. `overseer.ts`
is touched zero times — it already calls the function and consumes only
`{allowed, reason, shouldUseByok, byokRouting}`.

**Review if:** any non-empty diff under `packages/workshop-backend/src/ai-gateway-billing/`, or
`overseer.ts:7108-7133` changes shape. Low churn here proves little — the whole subsystem is 5
commits old and sits on upstream's active billing frontier. Expect to rewrite it from scratch the
day Cloudflare ships real billing.

---

## `fabric-user-lifecycle` — NOT YET LANDED

**Files:** `packages/workshop-backend/src/user-directory.ts`, `packages/workshop-backend/src/user.ts`

**Why no seam:** `user-directory.ts` contains no delete of any kind — erasure is not merely
unimplemented, it is inexpressible. `UserDurableObject` has no `purgeSelf`.

**Review if:** either file changes shape, particularly the directory's storage layout.

---

## `fabric-display-name` — LANDED 2026-09-17

**Files:** `packages/workshop-backend/src/auth/login-flow.ts`,
`packages/workshop-backend/src/user.ts`

**Why no seam:** `loginOrCreateViaGatekeeper` seeds a new account's display name from
`email.split("@")[0]`, and nothing lets a gatekeeper influence it. `AccountDescription.displayName`
already exists and every vendor implements it, but core never asks for it on the login path.

**Why it was needed:** this distro keys accounts on an opaque, stable WorkOS user id rather than an
email, so that changing an email cannot strand a user in a new empty workspace, a tenant dimension
can be added without migrating every Durable Object, and the personal identifier stays out of the DO
name, the session-token prefix, the directory row and `cf-aig-metadata.user`. An opaque id has no
local-part, so without this every account is created named `user_01KG8V3HVEF295G2GVXSVHBCA5`.

**Shape:** `#deliver` additionally calls `account.describe()` and passes `displayName` through; the
argument is optional and a missing, blank or failed name falls back to upstream's exact behaviour.
~31 lines across two files, the larger half in `auth/` — 3 commits in 6 weeks, among the coldest
directories in the repo.

**Review if:** `loginOrCreateViaGatekeeper`'s signature changes, `#deliver` stops calling
`getAuthenticatedEmail`, or `AccountDescription` drops `displayName`.

**Covered by:** `packages/workshop-backend/__tests__/fabric-display-name.test.ts`. Verified to fail
without the patch — 2 of its 5 cases go red, while the three fallback cases stay green because they
assert upstream's own behaviour.

**Deliberately not patched:** the profile avatar. `AccountDescription.avatar` is a `{url}`, but the
user avatar is an uploaded image in KV — a different mechanism — so auto-populating it would put an
external fetch on the sign-in path. A blank avatar is an ordinary state; this is not worth a patch.

---

## `fabric-popupless-signin` — LANDED 2026-09-17

**Files:** `packages/workshop-backend/src/auth/login-flow.ts`,
`packages/workshop-backend/src/server.ts`, `packages/workshop-shared/src/api.ts`

**High-churn:** `packages/workshop-backend/src/server.ts`, `packages/workshop-shared/src/api.ts` — taken deliberately (see Budget note below); the patch ledger gate refuses a high-churn file a patch does not name here.

**Why no seam:** the session token is minted inside the kernel and released only by
`LoginAttempt.receive()`, on an `RpcTarget` constructed per attempt and returned over the live Cap'n
Web connection (`server.ts:715`). It is deliberately unaddressable — "the client redeems the login
result through a capability rather than a guessable id" — so nothing outside the kernel can reach a
token, and `confirmLogin` (the one call a session-less page can make) returns `void`. A deployment
cannot add a redemption path from its own code.

**Why it was needed:** sign-in did not work at all in a browser embedded in another application — an
in-app browser, a desktop app's web pane — because `window.open()` returns null there for a genuine
user click, with no pop-up setting the user can allow. Measured in one such pane on 2026-09-17, with
the deployed bundle verified byte-identical to a build that opens the popup inside the gesture. The
pop-up is not the identity provider's requirement: WorkOS's own SDKs never call `window.open` —
AuthKit signs in with a full-page redirect and finishes with a cookie — and their Electron SDK
defaults to handing off to the system browser precisely to keep OAuth out of embedded webviews.

**Shape:** `PendingLogin.redeem(ticket)` confirms and releases in one step, ~8 lines beside the
existing `confirm`/`receive` pair it is built from; `PublicApiImpl.redeemLogin(ticket, nonce)` is the
same nonce→object lookup `confirmLogin` already does; `api.ts` gains one method. The popup path is
untouched and still preferred, because splitting the two secrets across two windows is what stops the
window touring the provider's pages from ever holding a token. The fallback requires BOTH secrets,
which is the pairing public OAuth clients already rely on: the ticket arrives in the URL like an
authorization code, the nonce waits in the tab's own sessionStorage like a PKCE verifier and never
travels.

**Review if:** `PendingLogin`'s result shape or `#result()` changes, `confirmLogin`'s lookup changes,
or upstream adds a redirect-based sign-in — which would retire this patch outright.

**Covered by:** `packages/workshop-backend/__tests__/fabric-popupless-signin.test.ts` (a new file, so
it adds no conflict surface): the release, a wrong ticket refused without spending the result, and an
attempt the gatekeeper has not answered.

**Budget note:** the fourth of ten, and the first taken deliberately in two of the high-churn files.
Authorised on the grounds above: sign-in did not work at all in an embedded browser, and no
deployment-side code could reach the token.

---

## `fabric-account-owner` — LANDED 2026-10-19

**Files:** `packages/workshop-shared/src/gatekeeper.ts`, `packages/workshop-backend/src/user.ts`,
`packages/gatekeeper-websearch/src/worker.ts`, `packages/gatekeeper-websearch/src/search.ts`,
`packages/gatekeeper-websearch/src/fabric-account-owner.ts`

**Why no seam:** the Workshop mints an auto-provisioned account with `GatekeeperVendor.createAccount()`
and no arguments (`#createAutoProvisionedAccount` in `user.ts`), and Web Search mints that account, and
the gatekeeper class the account hands out, with empty props (`worker.ts`). Its `ApprovalQueue` never
names the caller either. So a search reaches `env.AI.websearch()` with a gateway, a query, a provider
and a limit, and nothing downstream of the kernel, Fabric's AI proxy included, can learn whose account
it came from. A wrapper around the binding cannot add what the gatekeeper was never told.

**Why it was needed:** Chris decided at 2026-10-20 00:14Z, answering "Who pays for a search" on
technicalmagic/fabric PR 371: "who pays? all tools and models should use and charge energy to the
owner (currently) and possibly in future if elected for the end-user". For Web Search that is the
PR's option (a): the workspace owner pays, through a kernel patch. A workspace's ambient Web Search is
its owner's auto-provisioned account (`ensureAmbientCapsules` in `overseer.ts`), so naming the account's
owner at mint names the workspace owner on every search, whoever in the workspace runs it.

**Shape:**

- `gatekeeper.ts`: `createAccount?(owner?: {principal: string})`, documented as an attribution that
  proves and grants nothing. A vendor that declares no parameter is unaffected: capnweb-validate drops
  an undeclared argument, and the Scheduler, Context Library and test vendors, which skip validation,
  never read it.
- `user.ts`: `#createAutoProvisionedAccount`, which both minting paths (`provisionAmbientAccount` and
  `#provisionMissingAccounts`) reach, passes `{principal: this.storage.profile.get().id}` once the
  user's account exists, and makes upstream's argument-less call before. `profile.id` is the identity
  string the DO is named by; `ctx.id.name` is absent when the DO is reached through `idFromString()`,
  as the Overseer reaches a workspace's owner.
- gatekeeper-websearch: `createAccount(owner)` mints `WebSearchAccount` with `{props: {principal}}`,
  refusing a malformed owner; the account gives `WebSearchGatekeeper` the same props; the session
  passes the principal to `search()`, which adds `principal` to the request only when there is one.
  The two helpers are in the new `src/fabric-account-owner.ts`. An account with no owner, minted
  before this patch or by a call that names none, is minted and searches exactly as upstream's does.

**The other side:** the request's `principal` is read by Fabric's AI proxy (`AiProxy.websearch()`),
which validates it and charges that owner. The proxy refuses any field it does not know, so it must
accept `principal` before a Web Search built from this patch is deployed against it.

**Deploy precondition:** Fabric must not switch Web Search on at a kernel pin without this patch. The
package exists without it (since 2026-10-13), so a deploy at such a pin would mint accounts that name
no owner, and nothing gives one an owner afterwards: the Workshop mints one auto-provisioned account
per vendor, and in Enabled mode never mints it again. Only a member who removes and re-adds Web Search
in Optional mode gets a new account. Fabric's proxy, as its PR 388 builds it, serves a search that
names nobody free in shadow billing and refuses it under enforce, so those members' searches would
stop once billing is enforced. A deploy can tell a pin that carries this patch by the file
`packages/gatekeeper-websearch/src/fabric-account-owner.ts`.

**Review if:** `createAccount` gains a parameter of its own, `#createAutoProvisionedAccount` stops
being the one place an auto-provisioned account is minted, the user DO stops being named by its
`profile.id`, or Web Search's request or props change shape. Upstream adding any way for a vendor, an
account or a search request to name the user it serves would retire this patch.

**Covered by:** `packages/workshop-backend/__tests__/fabric-account-owner.test.ts` (both minting paths
name the owner, taken from the account's identity rather than the DO's name; before the account exists
the call is upstream's; an account minted without an owner is never minted again, the reason for the
deploy precondition) and `packages/gatekeeper-websearch/__tests__/fabric-account-owner.test.ts` (the
owner flows from `createAccount` through both props to the request; no owner, an account with empty
props, and a malformed owner leave the request or the mint exactly upstream's or refused; the interface's
argument stays optional, checked by the package's `tsc`). `workshop-shared` has no test task upstream,
and its change is a type that both suites compile against. Verified to fail without the patch: 4 of
the backend's 6 cases and 4 of Web Search's 8 go red; the others assert upstream's own behaviour.

**Budget note:** the sixth of ten, numbered after `fabric-email-host` (fork PR 4), which holds the
fifth. None of the high-churn files. `user.ts` is warm (17 upstream commits since 2026-09-19), but the
lines patched in it and in `gatekeeper.ts` have not moved since 2026-06-30; the Web Search package
dates from 2026-10-13.
