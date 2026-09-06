import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type Stripe from "stripe";
import { validateApprovedConnectAccount } from "../../../../supabase/functions/stripe-connect-session/connect.ts";
import * as contracts from "./contracts.ts";

const approvedAccountContract: Stripe.V2.Core.Account = {
  id: "acct_ApprovedDiagnosticFixture",
  object: "v2.core.account",
  dashboard: "express",
  applied_configurations: ["recipient"],
  configuration: {
    recipient: {
      applied: true,
      capabilities: {
        stripe_balance: {
          stripe_transfers: { status: "active", status_details: [] },
          payouts: { status: "active", status_details: [] },
        },
      },
    },
  },
  created: "2026-09-04T00:00:00.000Z",
  defaults: {
    currency: "usd",
    responsibilities: {
      fees_collector: "application",
      losses_collector: "application",
      requirements_collector: "stripe",
    },
  },
  livemode: false,
  requirements: { entries: [] },
};

Deno.test("account diagnostic classifies retrieval failure without exposing the provider error", async () => {
  const retrieve = Reflect.get(contracts, "retrieveAccountForDiagnostic");
  assertEquals(typeof retrieve, "function");
  if (typeof retrieve !== "function") return;

  const result = await retrieve(async () => {
    throw new Error("provider body must not escape");
  });

  assertEquals(result, { ok: false, kind: "ACCOUNT_RETRIEVE_FAILED" });
  assertEquals(JSON.stringify(result).includes("provider body"), false);
});

Deno.test("account diagnostic reports only the fixed approved-contract bitmap on mismatch", () => {
  const validate = Reflect.get(contracts, "validateAccountForDiagnostic");
  assertEquals(typeof validate, "function");
  if (typeof validate !== "function") return;

  const result = validate(
    {
      id: "acct_must_not_escape",
      dashboard: "full",
      applied_configurations: ["merchant"],
      defaults: {
        currency: "eur",
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
          requirements_collector: "application",
          arbitrary_provider_field: "must not escape",
        },
      },
    },
    () => {
      throw new Error("INVALID_STRIPE_ACCOUNT");
    },
  );

  assertEquals(result, {
    ok: false,
    kind: "ACCOUNT_CONTRACT_MISMATCH",
    account_contract: {
      dashboard_is_express: false,
      recipient_configuration_only: false,
      default_currency_is_usd: false,
      fees_collector_is_application: false,
      losses_collector_is_application: false,
      requirements_collector_is_stripe: false,
    },
  });
  const serialized = JSON.stringify(result);
  assertEquals(serialized.includes("acct_"), false);
  assertEquals(serialized.includes("arbitrary_provider_field"), false);
  assertEquals(serialized.includes("must not escape"), false);
});

Deno.test("account diagnostic requires the authoritative validator before reporting success", () => {
  const validate = Reflect.get(contracts, "validateAccountForDiagnostic");
  assertEquals(typeof validate, "function");
  if (typeof validate !== "function") return;

  let validationCount = 0;
  const projection: ReturnType<typeof validateApprovedConnectAccount> = {
    transfersStatus: "active",
    payoutsStatus: "active",
    requirementsStatus: "clear",
    requirementsCurrentlyDueCount: 0,
    requirementsPastDueCount: 0,
    lastStatusCode: null,
  };
  assertEquals(
    validate(approvedAccountContract, (account: Stripe.V2.Core.Account) => {
      validationCount += 1;
      return validateApprovedConnectAccount(account);
    }),
    { ok: true, projection },
  );
  assertEquals(validationCount, 1);

  assertEquals(
    validate(approvedAccountContract, () => {
      throw new Error("INVALID_STRIPE_ACCOUNT");
    }),
    {
      ok: false,
      kind: "ACCOUNT_CONTRACT_MISMATCH",
      account_contract: {
        dashboard_is_express: true,
        recipient_configuration_only: true,
        default_currency_is_usd: true,
        fees_collector_is_application: true,
        losses_collector_is_application: true,
        requirements_collector_is_stripe: true,
      },
    },
  );
});

Deno.test("diagnostic cleanup preserves unless account retirement is explicitly requested", async () => {
  const cleanupAccount = Reflect.get(
    contracts,
    "applyDiagnosticAccountCleanup",
  );
  assertEquals(typeof cleanupAccount, "function");
  if (typeof cleanupAccount !== "function") return;

  let retrieveCount = 0;
  let closeCount = 0;
  const retrieve = async () => {
    retrieveCount += 1;
    return { closed: false, livemode: false };
  };
  const close = async () => {
    closeCount += 1;
    return { closed: true, livemode: false };
  };
  const assertTestMode = (account: { livemode: boolean }) => {
    if (account.livemode !== false) throw new Error("LIVE_MODE_FORBIDDEN");
  };

  assertEquals(
    await cleanupAccount(false, retrieve, close, assertTestMode),
    { connectedAccountClosed: false, connectedAccountPreserved: true },
  );
  assertEquals({ retrieveCount, closeCount }, {
    retrieveCount: 0,
    closeCount: 0,
  });

  assertEquals(
    await cleanupAccount(true, retrieve, close, assertTestMode),
    { connectedAccountClosed: true, connectedAccountPreserved: false },
  );
  assertEquals({ retrieveCount, closeCount }, {
    retrieveCount: 1,
    closeCount: 1,
  });
});

Deno.test("fixture Auth passwords stay within the Supabase Auth bcrypt boundary", () => {
  const createPassword = Reflect.get(contracts, "createFixtureAuthPassword");
  assertEquals(typeof createPassword, "function");
  if (typeof createPassword !== "function") return;

  const password = createPassword("12345678-1234-4234-8234-123456789abc");

  assertEquals(password, "12345678123442348234123456789abcAa1!");
  assertEquals(password.length <= 72, true);
  assertEquals(/[a-z]/.test(password), true);
  assertEquals(/[A-Z]/.test(password), true);
  assertEquals(/[0-9]/.test(password), true);
  assertEquals(/[^A-Za-z0-9]/.test(password), true);
  assertEquals(password.includes("-"), false);
});

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

Deno.test("audit tombstone accepts only directly observed inert reusable state", () => {
  const auditTombstoneIsSafe = Reflect.get(
    contracts,
    "auditTombstoneIsSafe",
  );
  assertEquals(typeof auditTombstoneIsSafe, "function");
  if (typeof auditTombstoneIsSafe !== "function") return;

  const safe = {
    stable_fixture: true,
    fixture_reusable: true,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    event_sellable: false,
    public_projection_count: 0,
    active_tier_count: 0,
    connect_count: 0,
    order_count: 0,
    item_count: 0,
    ticket_count: 0,
    receipt_count: 0,
    refund_count: 0,
    dispute_count: 0,
  };

  assertEquals(auditTombstoneIsSafe(safe), true);
  for (
    const key of [
      "stable_fixture",
      "fixture_reusable",
      "auth_user_inert",
    ] as const
  ) {
    assertEquals(auditTombstoneIsSafe({ ...safe, [key]: false }), false);
  }
  for (
    const key of [
      "event_sellable",
      "public_projection_count",
      "active_tier_count",
      "connect_count",
      "order_count",
      "item_count",
      "ticket_count",
      "receipt_count",
      "refund_count",
      "dispute_count",
    ]
  ) {
    assertEquals(auditTombstoneIsSafe({ ...safe, [key]: 1 }), false);
  }
  assertEquals(auditTombstoneIsSafe({ ...safe, event_count: 0 }), false);
  assertEquals(auditTombstoneIsSafe({ ...safe, organizer_count: 0 }), false);
});

Deno.test("driver tombstone safety trusts only facts the driver directly observes", () => {
  const auditTombstoneIsSafe = Reflect.get(
    contracts,
    "auditTombstoneIsSafe",
  );
  assertEquals(typeof auditTombstoneIsSafe, "function");
  if (typeof auditTombstoneIsSafe !== "function") return;

  assertEquals(
    auditTombstoneIsSafe({
      stable_fixture: true,
      fixture_reusable: true,
      event_count: 1,
      organizer_count: 1,
      auth_user_inert: true,
      event_sellable: false,
      public_projection_count: 0,
      active_tier_count: 0,
      connect_count: 0,
      order_count: 0,
      item_count: 0,
      ticket_count: 0,
      receipt_count: 0,
      refund_count: 0,
      dispute_count: 0,
    }),
    true,
  );
});

Deno.test("connected-account retirement requires the certified immutable audit tombstone", async () => {
  const retireCertifiedConnectedAccount = Reflect.get(
    contracts,
    "retireCertifiedConnectedAccount",
  );
  assertEquals(typeof retireCertifiedConnectedAccount, "function");
  if (typeof retireCertifiedConnectedAccount !== "function") return;

  const state = {
    stable_fixture: true,
    fixture_reusable: true,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    event_sellable: false,
    public_projection_count: 0,
    active_tier_count: 0,
    connect_count: 0,
    order_count: 0,
    item_count: 0,
    ticket_count: 0,
    receipt_count: 0,
    refund_count: 0,
    dispute_count: 0,
  };
  const certification = {
    namespace_prefix_count: 1,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    audit_interval_count: 3,
    audit_action_count: 3,
    open_eligible_interval_count: 0,
    active_tier_count: 0,
    tier_count: 0,
    connect_count: 0,
    order_count: 0,
    item_count: 0,
    ticket_count: 0,
    refund_count: 0,
    public_projection_count: 0,
    staff_role_count: 0,
    event_tombstoned: true,
  };
  const calls: string[] = [];
  assertEquals(
    await retireCertifiedConnectedAccount(
      state,
      certification,
      async () => {
        calls.push("close");
        return {
          connectedAccountClosed: true,
          connectedAccountPreserved: false,
        };
      },
    ),
    {
      connectedAccountClosed: true,
      connectedAccountPreserved: false,
    },
  );
  assertEquals(calls, ["close"]);

  for (
    const unsafeCertification of [
      { ...certification, audit_interval_count: 2 },
      { ...certification, audit_action_count: 2 },
      { ...certification, open_eligible_interval_count: 1 },
      { ...certification, namespace_prefix_count: 2 },
      { ...certification, staff_role_count: 1 },
      { ...certification, event_tombstoned: false },
    ]
  ) {
    await assertRejects(
      () =>
        retireCertifiedConnectedAccount(
          state,
          unsafeCertification,
          async () => {
            calls.push("unsafe-close");
            return {
              connectedAccountClosed: true,
              connectedAccountPreserved: false,
            };
          },
        ),
      Error,
      "FIXTURE_CERTIFICATION_FAILED",
    );
  }
  assertEquals(calls, ["close"]);
});

Deno.test("fixture moderation targets one exact current case", () => {
  const exactFixtureModerationTarget = Reflect.get(
    contracts,
    "exactFixtureModerationTarget",
  );
  assertEquals(typeof exactFixtureModerationTarget, "function");
  if (typeof exactFixtureModerationTarget !== "function") return;

  const eventId = "00000000-0000-4000-8000-000000000001";
  const target = exactFixtureModerationTarget(eventId, [{
    evaluation_id: "00000000-0000-4000-8000-000000000003",
    event_id: eventId,
    content_revision: 4,
    input_sha256: "a".repeat(64),
    queued_moderation_version: 7,
  }]);
  assertEquals(target, {
    p_evaluation_id: "00000000-0000-4000-8000-000000000003",
    p_content_revision: 4,
    p_input_sha256: "a".repeat(64),
    p_queued_moderation_version: 7,
    p_outcome: "clear_candidate",
    p_risk_level: "low",
    p_reason_codes: ["no_violation"],
    p_provider_reference: null,
    p_model_version: null,
  });

  for (
    const cases of [
      [],
      [target, target],
      [{ ...target, event_id: "00000000-0000-4000-8000-000000000002" }],
      [{ ...target, event_id: eventId, evaluation_id: "unsafe" }],
      [{ ...target, event_id: eventId, input_sha256: "unsafe" }],
    ]
  ) {
    assertThrows(
      () => exactFixtureModerationTarget(eventId, cases),
      Error,
      "FIXTURE_MODERATION_FAILED",
    );
  }
});

Deno.test("failed fixture cleanup retries Auth inerting without retiring the account", async () => {
  const runCleanupWithFailureFinalizers = Reflect.get(
    contracts,
    "runCleanupWithFailureFinalizers",
  );
  assertEquals(typeof runCleanupWithFailureFinalizers, "function");
  if (typeof runCleanupWithFailureFinalizers !== "function") return;

  const calls: string[] = [];
  await assertRejects(
    () =>
      runCleanupWithFailureFinalizers(
        async () => {
          calls.push("cleanup");
          throw new Error("DATABASE");
        },
        async () => calls.push("auth"),
      ),
    Error,
    "DATABASE",
  );
  assertEquals(calls, ["cleanup", "auth"]);
});

Deno.test("failed fixture cleanup reports unsafe when Auth inerting also fails", async () => {
  const runCleanupWithFailureFinalizers = Reflect.get(
    contracts,
    "runCleanupWithFailureFinalizers",
  );
  assertEquals(typeof runCleanupWithFailureFinalizers, "function");
  if (typeof runCleanupWithFailureFinalizers !== "function") return;

  const calls: string[] = [];
  await assertRejects(
    () =>
      runCleanupWithFailureFinalizers(
        async () => {
          calls.push("cleanup");
          throw new Error("DATABASE");
        },
        async () => {
          calls.push("auth");
          throw new Error("auth finalizer failed");
        },
      ),
    Error,
    "FIXTURE_CLEANUP_UNSAFE",
  );
  assertEquals(calls, ["cleanup", "auth"]);
});

Deno.test("fixture stage failures sanitize thrown client errors to fixed diagnostics", async () => {
  const runFixtureStage = Reflect.get(contracts, "runFixtureStage");
  assertEquals(typeof runFixtureStage, "function");
  if (typeof runFixtureStage !== "function") return;

  for (
    const kind of [
      "FIXTURE_PREPARATION_FAILED",
      "FIXTURE_ORGANIZER_FAILED",
      "FIXTURE_ACCOUNT_BINDING_FAILED",
      "FIXTURE_EVENT_FAILED",
      "FIXTURE_TIER_SETUP_FAILED",
      "FIXTURE_MODERATION_FAILED",
      "FIXTURE_AUTH_FAILED",
      "FIXTURE_DISCLOSURE_SAVE_FAILED",
      "FIXTURE_POLICY_ACCEPTANCE_FAILED",
      "FIXTURE_PUBLISH_FAILED",
      "FIXTURE_ELIGIBILITY_FAILED",
      "FIXTURE_CHECKOUT_PREFLIGHT_FAILED",
    ] as const
  ) {
    await assertRejects(
      () =>
        runFixtureStage(kind, async () => {
          throw new Error("raw database/provider details must not escape");
        }),
      Error,
      kind,
    );
  }
});

Deno.test("fixture Connect upsert targets the real composite primary key", () => {
  assertEquals(
    Reflect.get(contracts, "CONNECT_ACCOUNT_CONFLICT_TARGET"),
    "organizer_id,livemode",
  );
});

Deno.test("fixture publication uses the authenticated owner flow before checkout preflight", async () => {
  const establishSellableFixture = Reflect.get(
    contracts,
    "establishSellableFixture",
  );
  assertEquals(typeof establishSellableFixture, "function");
  if (typeof establishSellableFixture !== "function") return;

  const calls: string[] = [];
  await establishSellableFixture(
    "organizer",
    "account",
    {
      saveRequirements: async () => calls.push("requirements"),
      acceptPolicies: async () => calls.push("acceptance"),
      publish: async () => calls.push("publication"),
      verifyEligibility: async () => calls.push("eligibility"),
      preflight: async () => {
        calls.push("preflight");
        return [{ organizer_id: "organizer", stripe_account_id: "account" }];
      },
    },
  );
  assertEquals(calls, [
    "requirements",
    "acceptance",
    "publication",
    "eligibility",
    "preflight",
  ]);
});

Deno.test("fixture publication fails closed on a non-bijective checkout preflight", async () => {
  const establishSellableFixture = Reflect.get(
    contracts,
    "establishSellableFixture",
  );
  assertEquals(typeof establishSellableFixture, "function");
  if (typeof establishSellableFixture !== "function") return;

  for (
    const preflight of [
      [],
      [{ organizer_id: "other", stripe_account_id: "account" }],
      [{ organizer_id: "organizer", stripe_account_id: "other" }],
      [
        { organizer_id: "organizer", stripe_account_id: "account" },
        { organizer_id: "organizer", stripe_account_id: "account" },
      ],
    ]
  ) {
    await assertRejects(
      () =>
        establishSellableFixture(
          "organizer",
          "account",
          {
            saveRequirements: async () => undefined,
            acceptPolicies: async () => undefined,
            publish: async () => undefined,
            verifyEligibility: async () => undefined,
            preflight: async () => preflight,
          },
        ),
      Error,
      "FIXTURE_CHECKOUT_PREFLIGHT_FAILED",
    );
  }
});

Deno.test("audit tombstone reuse resolves exact moderation before owner reauthorization", async () => {
  const restoreSellableFixture = Reflect.get(
    contracts,
    "restoreSellableFixture",
  );
  assertEquals(typeof restoreSellableFixture, "function");
  if (typeof restoreSellableFixture !== "function") return;

  const calls: string[] = [];
  await restoreSellableFixture(
    "organizer",
    "account",
    {
      reviseEvent: async () => calls.push("revision"),
      saveRequirements: async () => calls.push("requirements"),
      acceptPolicies: async () => calls.push("acceptance"),
      resolveModeration: async () => calls.push("moderation"),
      publish: async () => calls.push("publication"),
      verifyEligibility: async () => calls.push("eligibility"),
      preflight: async () => {
        calls.push("preflight");
        return [{ organizer_id: "organizer", stripe_account_id: "account" }];
      },
    },
  );
  assertEquals(calls, [
    "moderation",
    "revision",
    "requirements",
    "acceptance",
    "publication",
    "eligibility",
    "preflight",
  ]);
});

Deno.test("fixture tombstoning invalidates authorization before proving it unsellable", async () => {
  const retireSellableFixture = Reflect.get(
    contracts,
    "retireSellableFixture",
  );
  assertEquals(typeof retireSellableFixture, "function");
  if (typeof retireSellableFixture !== "function") return;

  const calls: string[] = [];
  await retireSellableFixture({
    retireRevision: async () => calls.push("revision"),
    verifyUnsellable: async () => calls.push("unsellable"),
  });
  assertEquals(calls, ["revision", "unsellable"]);
});

Deno.test("fixture retirement verifies the audit tombstone after every inerting step", async () => {
  const establishAuditTombstone = Reflect.get(
    contracts,
    "establishAuditTombstone",
  );
  assertEquals(typeof establishAuditTombstone, "function");
  if (typeof establishAuditTombstone !== "function") return;

  const calls: string[] = [];
  const state = {
    stable_fixture: true,
    fixture_reusable: true,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    event_sellable: false,
    public_projection_count: 0,
    active_tier_count: 0,
    connect_count: 0,
    order_count: 0,
    item_count: 0,
    ticket_count: 0,
    receipt_count: 0,
    refund_count: 0,
    dispute_count: 0,
  };
  await assertEquals(
    await establishAuditTombstone({
      retireEvent: async () => calls.push("event"),
      removeRuntime: async () => calls.push("runtime"),
      inertAuth: async () => calls.push("auth"),
      inspect: async () => {
        calls.push("inspect");
        return state;
      },
    }),
    state,
  );
  assertEquals(calls, ["event", "runtime", "auth", "inspect"]);
});

Deno.test("public projection verification accepts only the exact inbound publishable credential", () => {
  const requirePublicApiKey = Reflect.get(contracts, "requirePublicApiKey");
  assertEquals(typeof requirePublicApiKey, "function");
  if (typeof requirePublicApiKey !== "function") return;

  const key = "sb_publishable_fixture";
  assertEquals(
    requirePublicApiKey(
      new Headers({
        apikey: key,
        authorization: `Bearer ${key}`,
      }),
    ),
    key,
  );
  for (
    const headers of [
      new Headers(),
      new Headers({ apikey: key }),
      new Headers({ apikey: key, authorization: "Bearer different" }),
      new Headers({
        apikey: "service_role_fixture",
        authorization: "Bearer service_role_fixture",
      }),
    ]
  ) {
    assertThrows(() => requirePublicApiKey(headers), Error, "INPUT");
  }
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
