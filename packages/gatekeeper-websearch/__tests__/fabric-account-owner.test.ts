// DOWNSTREAM (fabric): a Web Search account's owner reaches its searches. Covers PATCH-ID
// fabric-account-owner.
//
// Chris decided on 2026-10-20 that a tool's use is charged to the workspace owner. The Workshop names
// the owner when it mints the account; these tests follow that principal from createAccount through
// the account's props and the gatekeeper class's props to the env.AI.websearch() request, and check
// that an account with no owner sends exactly upstream's request.
//
// Like upstream's Slack tests, they run the Worker's own classes under Node, emulating only the
// hosting surface: ctx.exports builds the next object with the props it is given, the way workerd
// and the Overseer's facets do.

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { GatekeeperVendor as GatekeeperVendorInterface } from "@gadgets/workshop-shared/gatekeeper";

vi.mock("cloudflare:workers", () => {
  class Entrypoint {
    constructor(public ctx: unknown, public env: unknown) {}
  }
  class Target { [Symbol.dispose]() {} }
  class Stub { dup() { return this; } }
  return { WorkerEntrypoint: Entrypoint, DurableObject: Entrypoint, RpcTarget: Target, RpcStub: Stub };
});
vi.mock("capnweb-validate", () => ({
  validateRpc: () => (target: unknown) => target,
  skipRpcValidation: () => (target: unknown) => target,
}));
vi.mock("../src/types.txt", () => ({ default: "" }));

const { GatekeeperVendor, WebSearchAccount, WebSearchGatekeeper } = await import("../src/worker.js");
const { search } = await import("../src/search.js");

const PRINCIPAL = "user_01KG8V3HVEF295G2GVXSVHBCA5";

// Upstream's request, field for field: what an account with no owner must keep sending.
const UPSTREAM_REQUEST = { gatewayId: "instance-ai", query: "q", provider: "ceramic", limit: 10 };

type Options = { props?: unknown } | undefined;
type Props = { principal?: string } | undefined;

/** A Worker as workerd hosts it: each ctx.exports call is recorded and builds what it names. */
function host() {
  const websearch = vi.fn(async (_request: unknown) =>
    Response.json({ items: [], metadata: { query: "q", requestId: "r", latencyMs: 1 } }));
  const env = { AI: { websearch }, CF_AI_GATEWAY: "instance-ai" } as unknown as Cloudflare.Env;
  const minted: { account: Options[]; gatekeeper: Options[] } = { account: [], gatekeeper: [] };
  const exports = {
    WebSearchAccount(options: Options) {
      minted.account.push(options);
      return account(options?.props as Props);
    },
    // A class reference: the Overseer instantiates it as a facet, with these props, to search.
    WebSearchGatekeeper(options: Options) {
      minted.gatekeeper.push(options);
      return { props: options?.props as Props };
    },
  };
  const account = (props: Props) =>
    new WebSearchAccount({ exports, props } as unknown as ExecutionContext, env);
  const vendor = new GatekeeperVendor({ exports } as unknown as ExecutionContext, env);
  return { websearch, minted, vendor, account, env };
}

const queue = {
  dup() { return this; },
  authorizeObservation: async () => {},
  [Symbol.dispose]() {},
} as unknown as Parameters<InstanceType<typeof WebSearchGatekeeper>["startSession"]>[0];

/** What one search from `account`'s workspace sends: through its class, a facet, and a session. */
async function searchFrom(
  { websearch, env }: ReturnType<typeof host>,
  account: InstanceType<typeof WebSearchAccount>,
): Promise<unknown> {
  const facetClass = await account.getSingletonGatekeeperClass() as unknown as { props: Props };
  const gatekeeper = new WebSearchGatekeeper(
      { props: facetClass.props } as unknown as DurableObjectState, env);
  const session = await gatekeeper.startSession(queue);
  await session.search("q");
  expect(websearch).toHaveBeenCalledTimes(1);
  return websearch.mock.calls[0]![0];
}

describe("the owner of a Web Search account", () => {
  it("is named in every search the account's workspace sends", async () => {
    const worker = host();

    const account = await worker.vendor.createAccount({ principal: PRINCIPAL });

    expect(worker.minted.account).toStrictEqual([{ props: { principal: PRINCIPAL } }]);
    const request = await searchFrom(worker, account as unknown as InstanceType<typeof WebSearchAccount>);
    expect(worker.minted.gatekeeper).toStrictEqual([{ props: { principal: PRINCIPAL } }]);
    expect(request).toStrictEqual({ ...UPSTREAM_REQUEST, principal: PRINCIPAL });
  });

  it("is absent, and the request upstream's exactly, when the mint names none", async () => {
    const worker = host();

    const account = await worker.vendor.createAccount();

    // Upstream's own arguments to both exports, not merely equivalent ones.
    expect(worker.minted.account).toStrictEqual([{}]);
    const request = await searchFrom(worker, account as unknown as InstanceType<typeof WebSearchAccount>);
    expect(worker.minted.gatekeeper).toStrictEqual([{}]);
    expect(request).toStrictEqual(UPSTREAM_REQUEST);
    expect(Object.keys(request as object)).not.toContain("principal");
  });

  it("is absent from an account minted before the patch, whose props are empty", async () => {
    for (const props of [{}, undefined]) {
      const worker = host();
      const request = await searchFrom(worker, worker.account(props));
      expect(worker.minted.gatekeeper).toStrictEqual([{}]);
      expect(request).toStrictEqual(UPSTREAM_REQUEST);
    }
  });

  it("must be a non-empty principal, or nothing is minted", async () => {
    // createAccount skips capnweb-validate, so the argument arrives over RPC unchecked.
    for (const owner of [null, {}, { principal: "" }, { principal: 7 }, PRINCIPAL, [PRINCIPAL]]) {
      const worker = host();
      await expect(worker.vendor.createAccount(owner as never)).rejects.toThrow(TypeError);
      expect(worker.minted.account).toStrictEqual([]);
    }
  });

  it("keeps only the principal from what the mint was given", async () => {
    const worker = host();

    await worker.vendor.createAccount({ principal: PRINCIPAL, email: "a@example.com" } as never);

    expect(worker.minted.account).toStrictEqual([{ props: { principal: PRINCIPAL } }]);
  });
});

describe("search", () => {
  it("adds the principal it is given, and nothing when it is given none", async () => {
    for (const [principal, expected] of [
      [PRINCIPAL, { ...UPSTREAM_REQUEST, principal: PRINCIPAL }],
      [undefined, UPSTREAM_REQUEST],
    ] as const) {
      const { websearch, env } = host();
      await search(env, "q", async () => {}, principal);
      expect(websearch.mock.calls[0]![0]).toStrictEqual(expected);
    }
  });

  it("still records the query before anything is sent", async () => {
    const { websearch, env } = host();
    const order: string[] = [];
    websearch.mockImplementationOnce(async () => {
      order.push("sent");
      return Response.json({ items: [] });
    });

    await search(env, "q", async () => { order.push("recorded"); }, PRINCIPAL);

    expect(order).toEqual(["recorded", "sent"]);
  });
});

describe("GatekeeperVendor.createAccount", () => {
  it("takes the owner as an optional argument, so a vendor that declares none still conforms", () => {
    type CreateAccount = NonNullable<GatekeeperVendorInterface["createAccount"]>;
    expectTypeOf<Parameters<CreateAccount>>().toEqualTypeOf<[owner?: { principal: string }]>();
    expectTypeOf<() => ReturnType<CreateAccount>>().toExtend<CreateAccount>();
  });
});
