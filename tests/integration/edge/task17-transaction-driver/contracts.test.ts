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

Deno.test("checkout diagnostic reports a fixed non-sensitive response bitmap", () => {
  const diagnose = Reflect.get(contracts, "checkoutSessionContractBitmap");
  assertEquals(typeof diagnose, "function");
  if (typeof diagnose !== "function") return;

  const orderId = "11111111-1111-4111-8111-111111111111";
  const eventId = "22222222-2222-4222-8222-222222222222";
  const session = {
    id: "cs_test_MustNotEscape",
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    status: "expired",
    payment_status: "unpaid",
    currency: "usd",
    amount_subtotal: 5_500,
    amount_total: 5_500,
    customer_email: "task17_a1b2c3d4e5f6-paid@example.invalid",
    client_reference_id: orderId,
    integration_identifier: "whereto_checkout_abcdefgh",
    metadata: {
      contract_version: "checkout_integrity_v1",
      event_id: eventId,
      order_id: orderId,
    },
    automatic_tax: { enabled: false },
    url: null,
    line_items: {
      has_more: false,
      data: [
        {
          quantity: 2,
          currency: "usd",
          amount_subtotal: 3_000,
          amount_total: 3_000,
          price: {
            livemode: false,
            currency: "usd",
            type: "one_time",
            unit_amount: 1_500,
            product: {
              livemode: false,
              metadata: {
                whereto_order_item_id: "33333333-3333-4333-8333-333333333333",
              },
            },
          },
        },
        {
          quantity: 1,
          currency: "usd",
          amount_subtotal: 2_500,
          amount_total: 2_500,
          price: {
            livemode: false,
            currency: "usd",
            type: "one_time",
            unit_amount: 2_500,
            product: {
              livemode: false,
              metadata: {
                whereto_order_item_id: "44444444-4444-4444-8444-444444444444",
              },
            },
          },
        },
      ],
    },
    payment_intent: null,
    arbitrary_provider_field: "must not escape",
  };

  const bitmap = diagnose(
    session,
    "task17_a1b2c3d4e5f6",
    "acct_MustNotEscape",
  );

  assertEquals(bitmap, {
    session_object_valid: true,
    test_mode: true,
    payment_mode: true,
    currency_usd: true,
    subtotal_exact: true,
    total_exact: true,
    payment_status_unpaid: true,
    fixture_buyer_bound: true,
    client_reference_bound: true,
    metadata_bound: true,
    integration_identifier_bound: true,
    automatic_tax_disabled: true,
    line_items_complete: true,
    line_count_exact: true,
    admission_count_exact: true,
    line_amounts_exact: true,
    line_bindings_unique: true,
    payment_intent_present: false,
    payment_intent_expanded: false,
    payment_intent_test_mode: false,
    payment_intent_amount_exact: false,
    application_fee_exact: false,
    destination_bound: false,
    payment_intent_metadata_bound: false,
    failure_cleanup_expired: true,
  });
  const serialized = JSON.stringify(bitmap);
  assertEquals(serialized.includes("cs_test_"), false);
  assertEquals(serialized.includes("acct_"), false);
  assertEquals(serialized.includes("@example.invalid"), false);
  assertEquals(serialized.includes(orderId), false);
  assertEquals(serialized.includes("arbitrary_provider_field"), false);
});

Deno.test("checkout diagnostic candidate is exact and has no age cutoff", () => {
  const isCandidate = Reflect.get(
    contracts,
    "isCheckoutDiagnosticCandidate",
  );
  assertEquals(typeof isCandidate, "function");
  if (typeof isCandidate !== "function") return;

  const prefix = "task17_a1b2c3d4e5f6";
  const eventId = "22222222-2222-4222-8222-222222222222";
  const orderId = "11111111-1111-4111-8111-111111111111";
  const candidate = {
    id: "cs_test_ExactOldSession",
    object: "checkout.session",
    created: 1,
    livemode: false,
    mode: "payment",
    payment_status: "unpaid",
    currency: "usd",
    amount_subtotal: 5_500,
    amount_total: 5_500,
    customer_email: `${prefix}-paid@example.invalid`,
    client_reference_id: orderId,
    integration_identifier: "whereto_checkout_abcdefgh",
    metadata: {
      contract_version: "checkout_integrity_v1",
      event_id: eventId,
      order_id: orderId,
    },
    automatic_tax: { enabled: false },
  };

  assertEquals(isCandidate(candidate, prefix, eventId), true);
  for (
    const collision of [
      { ...candidate, amount_total: 5_499 },
      { ...candidate, customer_email: `${prefix}-declined@example.invalid` },
      { ...candidate, integration_identifier: "whereto_checkout_wrong123" },
      {
        ...candidate,
        client_reference_id: "33333333-3333-4333-8333-333333333333",
      },
      {
        ...candidate,
        metadata: { ...candidate.metadata, event_id: orderId },
      },
      {
        ...candidate,
        metadata: { ...candidate.metadata, unexpected: "must reject" },
      },
    ]
  ) {
    assertEquals(isCandidate(collision, prefix, eventId), false);
  }
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

Deno.test("cleanup stage failures sanitize provider errors to the exact fixed stage", async () => {
  const runCleanupStage = Reflect.get(contracts, "runCleanupStage");
  assertEquals(typeof runCleanupStage, "function");
  if (typeof runCleanupStage !== "function") return;

  for (
    const kind of [
      "CLEANUP_SESSION_RETRIEVE_FAILED",
      "CLEANUP_SESSION_EXPIRE_FAILED",
      "CLEANUP_CATALOG_DISCOVERY_FAILED",
      "CLEANUP_PRICE_ARCHIVE_FAILED",
      "CLEANUP_PRODUCT_ARCHIVE_FAILED",
    ] as const
  ) {
    await assertRejects(
      () =>
        runCleanupStage(kind, async () => {
          throw new Error("raw provider response must not escape");
        }),
      Error,
      kind,
    );
  }
});

Deno.test("cleanup archives every Price before any Product and resumes a partial Price pass", async () => {
  const archiveCatalog = Reflect.get(contracts, "archiveCleanupCatalog");
  assertEquals(typeof archiveCatalog, "function");
  if (typeof archiveCatalog !== "function") return;

  const activePrices = new Set(["price_one", "price_two"]);
  const activeProducts = new Set(["prod_one", "prod_two"]);
  const calls: string[] = [];
  let failSecondPrice = true;
  const dependencies = {
    updatePrice: async (id: string, update: { active: false }) => {
      calls.push(`price:${id}:${update.active}`);
      if (id === "price_two" && failSecondPrice) {
        failSecondPrice = false;
        throw new Error("provider detail");
      }
      activePrices.delete(id);
      return { active: false, livemode: false };
    },
    updateProduct: async (id: string, update: { active: false }) => {
      calls.push(`product:${id}:${update.active}`);
      activeProducts.delete(id);
      return { active: false, livemode: false };
    },
    assertPriceArchived: (value: { active: boolean; livemode: boolean }) => {
      if (value.active || value.livemode) throw new Error("invalid Price");
    },
    assertProductArchived: (value: { active: boolean; livemode: boolean }) => {
      if (value.active || value.livemode) throw new Error("invalid Product");
    },
  };

  await assertRejects(
    () =>
      archiveCatalog(
        ["price_one", "price_two"],
        ["prod_one", "prod_two"],
        dependencies,
      ),
    Error,
    "CLEANUP_PRICE_ARCHIVE_FAILED",
  );
  assertEquals(calls, ["price:price_one:false", "price:price_two:false"]);
  assertEquals(activeProducts.size, 2);

  await archiveCatalog(
    ["price_one", "price_two"],
    ["prod_one", "prod_two"],
    dependencies,
  );
  assertEquals(calls, [
    "price:price_one:false",
    "price:price_two:false",
    "price:price_one:false",
    "price:price_two:false",
    "product:prod_one:false",
    "product:prod_two:false",
  ]);
  assertEquals(activePrices.size, 0);
  assertEquals(activeProducts.size, 0);
});

Deno.test("cleanup resumes a partial Product pass without skipping the Price barrier", async () => {
  const archiveCatalog = Reflect.get(contracts, "archiveCleanupCatalog");
  assertEquals(typeof archiveCatalog, "function");
  if (typeof archiveCatalog !== "function") return;

  const calls: string[] = [];
  let failSecondProduct = true;
  const dependencies = {
    updatePrice: async (id: string, update: { active: false }) => {
      calls.push(`price:${id}:${update.active}`);
      return { active: false };
    },
    updateProduct: async (id: string, update: { active: false }) => {
      calls.push(`product:${id}:${update.active}`);
      if (id === "prod_two" && failSecondProduct) {
        failSecondProduct = false;
        throw new Error("provider detail");
      }
      return { active: false };
    },
    assertPriceArchived: (value: { active: boolean }) => {
      if (value.active) throw new Error("invalid Price");
    },
    assertProductArchived: (value: { active: boolean }) => {
      if (value.active) throw new Error("invalid Product");
    },
  };

  await assertRejects(
    () => archiveCatalog(["price_one"], ["prod_one", "prod_two"], dependencies),
    Error,
    "CLEANUP_PRODUCT_ARCHIVE_FAILED",
  );
  await archiveCatalog(["price_one"], ["prod_one", "prod_two"], dependencies);

  assertEquals(calls, [
    "price:price_one:false",
    "product:prod_one:false",
    "product:prod_two:false",
    "price:price_one:false",
    "product:prod_one:false",
    "product:prod_two:false",
  ]);
});

Deno.test("cleanup preparation accepts only the bounded residual or canonical runtime shape", () => {
  const preparedIsSafe = Reflect.get(contracts, "cleanupPreparedStateIsSafe");
  assertEquals(typeof preparedIsSafe, "function");
  if (typeof preparedIsSafe !== "function") return;

  const residual = {
    stable_fixture: true,
    fixture_reusable: true,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    event_sellable: false,
    public_projection_count: 0,
    active_tier_count: 2,
    connect_count: 1,
    order_count: 1,
    item_count: 2,
    ticket_count: 0,
    receipt_count: 1,
    refund_count: 0,
    dispute_count: 0,
  };
  const canonical = {
    ...residual,
    order_count: 2,
    item_count: 4,
    ticket_count: 3,
    refund_count: 1,
    receipt_count: 6,
  };

  assertEquals(preparedIsSafe(residual), true);
  assertEquals(preparedIsSafe(canonical), true);
  for (
    const unsafe of [
      { ...residual, event_sellable: true },
      { ...residual, auth_user_inert: false },
      { ...residual, order_count: 2 },
      { ...canonical, dispute_count: 1 },
      { ...canonical, receipt_count: 0 },
      { ...canonical, item_count: 3 },
    ]
  ) {
    assertEquals(preparedIsSafe(unsafe), false);
  }
});

Deno.test("normal cleanup can prepare bounded partial setup state without widening cleanup-only admission", () => {
  const runtimeIsSafe = Reflect.get(contracts, "cleanupRuntimeStateIsSafe");
  assertEquals(typeof runtimeIsSafe, "function");
  if (typeof runtimeIsSafe !== "function") return;

  const partial = {
    stable_fixture: true,
    fixture_reusable: true,
    event_count: 1,
    organizer_count: 1,
    auth_user_inert: true,
    event_sellable: false,
    public_projection_count: 0,
    active_tier_count: 1,
    connect_count: 1,
    order_count: 0,
    item_count: 0,
    ticket_count: 0,
    receipt_count: 0,
    refund_count: 0,
    dispute_count: 0,
  };
  assertEquals(runtimeIsSafe(partial), true);
  assertEquals(runtimeIsSafe({ ...partial, active_tier_count: 3 }), false);
  assertEquals(runtimeIsSafe({ ...partial, order_count: 3 }), false);
  assertEquals(runtimeIsSafe({ ...partial, dispute_count: 1 }), false);
});

Deno.test("cleanup authenticates the fixture owner only when retirement is still required", async () => {
  const retireFixture = Reflect.get(
    contracts,
    "retireSellableFixtureWithLazyOwner",
  );
  assertEquals(typeof retireFixture, "function");
  if (typeof retireFixture !== "function") return;

  const alreadyRetiredCalls: string[] = [];
  await retireFixture(true, {
    authenticateOwner: async () => {
      alreadyRetiredCalls.push("auth");
      return "owner";
    },
    retireRevision: async () => alreadyRetiredCalls.push("revision"),
    verifyUnsellable: async () => alreadyRetiredCalls.push("unsellable"),
  });
  assertEquals(alreadyRetiredCalls, ["unsellable"]);

  const activeCalls: string[] = [];
  await retireFixture(false, {
    authenticateOwner: async () => {
      activeCalls.push("auth");
      return "owner";
    },
    retireRevision: async (owner: string) => {
      assertEquals(owner, "owner");
      activeCalls.push("revision");
    },
    verifyUnsellable: async () => activeCalls.push("unsellable"),
  });
  assertEquals(activeCalls, ["auth", "revision", "unsellable"]);
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
