import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as contracts from "./contracts.ts";

Deno.test("fixture Auth lookup follows every page and returns only the exact identity", async () => {
  const findUser = Reflect.get(contracts, "findExactFixtureAuthUser");
  assertEquals(typeof findUser, "function");
  if (typeof findUser !== "function") return;

  const pages: number[] = [];
  const result = await findUser(
    "fixture@example.invalid",
    async (page: number) => {
      pages.push(page);
      return page === 1
        ? {
          users: [{
            id: "11111111-1111-4111-8111-111111111111",
            email: "other@example.invalid",
          }],
          nextPage: 2,
        }
        : {
          users: [{
            id: "22222222-2222-4222-8222-222222222222",
            email: "fixture@example.invalid",
          }],
          nextPage: null,
        };
    },
  );

  assertEquals(pages, [1, 2]);
  assertEquals(result, { id: "22222222-2222-4222-8222-222222222222" });
});

Deno.test("fixture Auth lookup proves absence and rejects ambiguous identities", async () => {
  const findUser = Reflect.get(contracts, "findExactFixtureAuthUser");
  assertEquals(typeof findUser, "function");
  if (typeof findUser !== "function") return;

  assertEquals(
    await findUser(
      "fixture@example.invalid",
      async () => ({ users: [], nextPage: null }),
    ),
    null,
  );
  await assertRejects(
    () =>
      findUser("fixture@example.invalid", async () => ({
        users: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            email: "fixture@example.invalid",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            email: "fixture@example.invalid",
          },
        ],
        nextPage: null,
      })),
    Error,
    "DATABASE",
  );
});

Deno.test("Auth cleanup deletes the exact fixture identity and proves ID and email absence", async () => {
  const deleteAndVerify = Reflect.get(
    contracts,
    "deleteAndVerifyFixtureAuthUser",
  );
  assertEquals(typeof deleteAndVerify, "function");
  if (typeof deleteAndVerify !== "function") return;

  const deleted: string[] = [];
  await deleteAndVerify(
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "fixture@example.invalid",
    },
    async (id: string) => deleted.push(id),
    async () => null,
    async () => ({ users: [], nextPage: null }),
  );
  assertEquals(deleted, ["22222222-2222-4222-8222-222222222222"]);

  await assertRejects(
    () =>
      deleteAndVerify(
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        },
        async () => undefined,
        async () => ({
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        }),
        async () => ({ users: [], nextPage: null }),
      ),
    Error,
    "DATABASE_DELETE_AUTH",
  );
  await assertRejects(
    () =>
      deleteAndVerify(
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        },
        async () => undefined,
        async () => null,
        async () => ({
          users: [{
            id: "33333333-3333-4333-8333-333333333333",
            email: "fixture@example.invalid",
          }],
          nextPage: null,
        }),
      ),
    Error,
    "DATABASE_DELETE_AUTH",
  );
});

Deno.test("destination-charge relations fail closed on every cross-wire", () => {
  const relationsMatch = Reflect.get(
    contracts,
    "destinationChargeRelationsMatch",
  );
  assertEquals(typeof relationsMatch, "function");
  if (typeof relationsMatch !== "function") return;

  const valid = {
    paymentIntentId: "pi_expected",
    chargeId: "ch_expected",
    transferId: "tr_expected",
    connectedAccountId: "acct_expected",
    charge: { payment_intent: "pi_expected", transfer: "tr_expected" },
    transfer: { source_transaction: "ch_expected" },
    applicationFee: { charge: "ch_expected", account: "acct_expected" },
  };
  assertEquals(relationsMatch(valid), true);

  const mutations = [
    { ...valid, charge: { ...valid.charge, payment_intent: "pi_crossed" } },
    { ...valid, charge: { ...valid.charge, transfer: "tr_crossed" } },
    { ...valid, transfer: { source_transaction: "ch_crossed" } },
    {
      ...valid,
      applicationFee: { ...valid.applicationFee, charge: "ch_crossed" },
    },
    {
      ...valid,
      applicationFee: { ...valid.applicationFee, account: "acct_crossed" },
    },
  ];
  for (const mutation of mutations) {
    assertEquals(relationsMatch(mutation), false);
  }
});

Deno.test("driver response guard allows summaries and rejects prohibited identifiers", () => {
  const assertSafe = Reflect.get(contracts, "assertSafeProofResponse");
  assertEquals(typeof assertSafe, "function");
  if (typeof assertSafe !== "function") return;

  const safe = {
    ok: true,
    event_id: "11111111-1111-4111-8111-111111111111",
    tier_id: "22222222-2222-4222-8222-222222222222",
    orders: [{ order_handle: "paid", status: "paid" }],
    tickets: [{ order_handle: "paid", ticket_count: 3, bindings_valid: true }],
  };
  assertEquals(assertSafe(safe), safe);

  for (
    const unsafe of [
      { provider: "pi_forbidden" },
      { ticket_id: "11111111-1111-4111-8111-111111111111" },
      { order_item_id: "22222222-2222-4222-8222-222222222222" },
      { stripe_event_id: "evt_forbidden" },
      { refund_id: "re_forbidden" },
    ]
  ) {
    assertThrows(() => assertSafe(unsafe), Error, "UNSAFE_PROOF_RESPONSE");
  }
});
