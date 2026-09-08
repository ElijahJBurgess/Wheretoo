import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import type Stripe from "stripe";
import { type OrganizerAuthDependencies, requireOrganizer } from "./auth.ts";
import { getCorsHeaders, handleCorsPreflight } from "./cors.ts";
import { deriveConnectStatus } from "./connectState.ts";
import { getServiceClient } from "./database.ts";
import {
  getAppBaseUrl,
  getStripeWebhookSecret,
  getStripeWebhookSecrets,
  getSupabaseServiceConfig,
  validateStripeRestrictedKey,
} from "./env.ts";
import { HttpError } from "./http.ts";
import {
  getStripe,
  rejectLiveStripeObject,
  STRIPE_API_VERSION,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_ATTEMPT_ENVELOPE_SECONDS,
  STRIPE_REQUEST_TIMEOUT_MS,
} from "./stripeClient.ts";
import { safeErrorResponse } from "./stripeErrors.ts";

const TEST_APP_ORIGIN = "https://whereto.example";

function testRestrictedKey(): string {
  return ["rk", "test", "unitboundary123"].join("_");
}

type RecipientConfiguration = NonNullable<
  NonNullable<Stripe.V2.Core.Account["configuration"]>["recipient"]
>;
type StripeBalanceCapabilities = NonNullable<
  NonNullable<RecipientConfiguration["capabilities"]>["stripe_balance"]
>;
type TransferCapability = NonNullable<
  StripeBalanceCapabilities["stripe_transfers"]
>;
type PayoutCapability = NonNullable<StripeBalanceCapabilities["payouts"]>;
type RequirementEntry = Stripe.V2.Core.Account.Requirements.Entry;

interface AccountFixtureOptions {
  id?: string;
  closed?: boolean;
  recipientApplied?: boolean;
  appliedConfigurations?: Stripe.V2.Core.Account["applied_configurations"];
  transferStatus?: TransferCapability["status"];
  payoutStatus?: PayoutCapability["status"];
  transferStatusDetails?: TransferCapability["status_details"];
  payoutStatusDetails?: PayoutCapability["status_details"];
  requirements?: RequirementEntry[];
}

function accountFixture(
  options: AccountFixtureOptions = {},
): Stripe.V2.Core.Account {
  return {
    id: options.id ?? "acct_testboundary",
    object: "v2.core.account",
    applied_configurations: options.appliedConfigurations ?? ["recipient"],
    closed: options.closed,
    configuration: {
      recipient: {
        applied: options.recipientApplied ?? true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              status: options.transferStatus ?? "active",
              status_details: options.transferStatusDetails ?? [],
            },
            payouts: {
              status: options.payoutStatus ?? "active",
              status_details: options.payoutStatusDetails ?? [],
            },
          },
        },
      },
    },
    created: "2026-08-25T00:00:00.000Z",
    livemode: false,
    requirements: { entries: options.requirements ?? [] },
  };
}

function requirementEntry(
  awaitingActionFrom: RequirementEntry["awaiting_action_from"],
  deadlineStatus: RequirementEntry["minimum_deadline"]["status"],
): RequirementEntry {
  return {
    awaiting_action_from: awaitingActionFrom,
    description: "Complete account verification",
    errors: [],
    impact: {},
    minimum_deadline: { status: deadlineStatus },
    requested_reasons: [{ code: "routine_onboarding" }],
  };
}

function envReader(
  values: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
  return (name) => values[name];
}

Deno.test("server Stripe env accepts only a non-empty restricted test key", () => {
  assertEquals(
    validateStripeRestrictedKey(testRestrictedKey()),
    testRestrictedKey(),
  );

  for (
    const rejected of [
      undefined,
      "",
      ["rk", "test", ""].join("_"),
      ["rk", "live", "unitboundary123"].join("_"),
      ["sk", "test", "unitboundary123"].join("_"),
      ["pk", "test", "unitboundary123"].join("_"),
      ` ${testRestrictedKey()}`,
      `${testRestrictedKey()} `,
    ]
  ) {
    assertThrows(
      () => validateStripeRestrictedKey(rejected),
      Error,
      "Stripe server credentials must be a restricted test key",
    );
  }
});

Deno.test("application origin env accepts one exact HTTP origin only", () => {
  const exactOrigin = "https://app.whereto.example";
  assertEquals(
    getAppBaseUrl(envReader({ APP_BASE_URL: exactOrigin })),
    exactOrigin,
  );

  for (
    const rejected of [
      `${exactOrigin}/`,
      `${exactOrigin}/path`,
      "javascript:alert(1)",
      "",
    ]
  ) {
    assertThrows(() => getAppBaseUrl(envReader({ APP_BASE_URL: rejected })));
  }
});

Deno.test("Supabase service env returns only its configured server boundary", () => {
  const url = "https://project.supabase.example";
  const serviceRoleKey = ["service", "role", "unitboundary"].join("-");
  const read = envReader({
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  });

  assertEquals(getSupabaseServiceConfig(read), { url, serviceRoleKey });
  assertThrows(() =>
    getSupabaseServiceConfig(envReader({ SUPABASE_URL: url }))
  );
});

Deno.test("webhook env accepts a non-empty signing secret shape without exposing it", () => {
  const webhookSecret = ["whsec", "unitboundary123"].join("_");
  assertEquals(
    getStripeWebhookSecret(
      envReader({ STRIPE_WEBHOOK_SECRET: webhookSecret }),
    ),
    webhookSecret,
  );

  for (const rejected of [undefined, "", ["whsec", ""].join("_")]) {
    assertThrows(() =>
      getStripeWebhookSecret(
        envReader(
          rejected === undefined ? {} : { STRIPE_WEBHOOK_SECRET: rejected },
        ),
      )
    );
  }
});

Deno.test("webhook env keeps snapshot and thin-event signing secrets in the server boundary", () => {
  const snapshot = ["whsec", "snapshotboundary123"].join("_");
  const thin = ["whsec", "thinboundary123"].join("_");
  assertEquals(
    getStripeWebhookSecrets(envReader({
      STRIPE_WEBHOOK_SECRET: snapshot,
      STRIPE_THIN_WEBHOOK_SECRET: thin,
    })),
    [snapshot, thin],
  );
  assertEquals(
    getStripeWebhookSecrets(envReader({ STRIPE_WEBHOOK_SECRET: snapshot })),
    [snapshot],
  );
});

Deno.test("getServiceClient consumes server config once and returns one client", () => {
  const previousUrl = Deno.env.get("SUPABASE_URL");
  const previousKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://project.supabase.example");
  Deno.env.set(
    "SUPABASE_SERVICE_ROLE_KEY",
    ["service", "role", "unitboundary"].join("-"),
  );

  try {
    const first = getServiceClient();
    const second = getServiceClient();
    assertStrictEquals(first, second);
  } finally {
    if (previousUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", previousUrl);
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
});

Deno.test("getStripe returns one test-key client pinned to the approved API version", () => {
  const previous = Deno.env.get("STRIPE_RESTRICTED_KEY");
  Deno.env.set("STRIPE_RESTRICTED_KEY", testRestrictedKey());

  try {
    const first = getStripe();
    const second = getStripe();

    assertStrictEquals(first, second);
    assertEquals(first.getApiField("version"), "2026-07-29.dahlia");
    assertEquals(first.getApiField("timeout"), 80_000);
    assertEquals(first.getApiField("maxNetworkRetries"), 2);
    assertEquals(STRIPE_API_VERSION, "2026-07-29.dahlia");
    assertEquals(STRIPE_REQUEST_TIMEOUT_MS, 80_000);
    assertEquals(STRIPE_MAX_NETWORK_RETRIES, 2);
    assertEquals(STRIPE_REQUEST_ATTEMPT_ENVELOPE_SECONDS, 240);
  } finally {
    if (previous === undefined) Deno.env.delete("STRIPE_RESTRICTED_KEY");
    else Deno.env.set("STRIPE_RESTRICTED_KEY", previous);
  }
});

Deno.test("server boundary rejects live or unmarked Stripe objects", () => {
  const testObject = { id: "object_test", livemode: false };
  const unmarkedObject = { id: "object_unknown" };
  assertStrictEquals(rejectLiveStripeObject(testObject), testObject);

  assertThrows(
    () => rejectLiveStripeObject({ id: "object_live", livemode: true }),
    HttpError,
  );
  assertThrows(() => rejectLiveStripeObject(unmarkedObject), HttpError);
});

Deno.test("CORS reflects only the exact configured application origin", () => {
  const exact = new Request("https://functions.example/connect", {
    headers: { Origin: TEST_APP_ORIGIN },
  });
  const sibling = new Request("https://functions.example/connect", {
    headers: { Origin: `${TEST_APP_ORIGIN}.attacker.test` },
  });
  const portVariant = new Request("https://functions.example/connect", {
    headers: { Origin: `${TEST_APP_ORIGIN}:443` },
  });

  assertEquals(
    getCorsHeaders(exact, TEST_APP_ORIGIN).get("access-control-allow-origin"),
    TEST_APP_ORIGIN,
  );
  assertEquals(
    getCorsHeaders(sibling, TEST_APP_ORIGIN).has("access-control-allow-origin"),
    false,
  );
  assertEquals(
    getCorsHeaders(portVariant, TEST_APP_ORIGIN).has(
      "access-control-allow-origin",
    ),
    false,
  );
});

// Mutation caught: omitting the independent confirmation bearer from the
// exact-origin preflight allow-list makes browser Checkout requests fail.
Deno.test("CORS allows the Checkout confirmation bearer only for the exact application origin", () => {
  const allowed = getCorsHeaders(
    new Request("https://functions.example/stripe-create-checkout", {
      headers: { Origin: TEST_APP_ORIGIN },
    }),
    TEST_APP_ORIGIN,
  );
  const denied = getCorsHeaders(
    new Request("https://functions.example/stripe-create-checkout", {
      headers: { Origin: "https://attacker.test" },
    }),
    TEST_APP_ORIGIN,
  );

  assertEquals(
    allowed.get("access-control-allow-headers"),
    "authorization, content-type, x-client-info, apikey, x-whereto-confirmation-bearer",
  );
  assertEquals(denied.has("access-control-allow-headers"), false);
});

Deno.test("CORS preflight denies an unapproved origin and allows the exact origin", async () => {
  const allowed = handleCorsPreflight(
    new Request("https://functions.example/connect", {
      method: "OPTIONS",
      headers: { Origin: TEST_APP_ORIGIN },
    }),
    TEST_APP_ORIGIN,
  );
  const denied = handleCorsPreflight(
    new Request("https://functions.example/connect", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.test" },
    }),
    TEST_APP_ORIGIN,
  );

  assertEquals(allowed?.status, 204);
  assertEquals(
    allowed?.headers.get("access-control-allow-origin"),
    TEST_APP_ORIGIN,
  );
  assertEquals(denied?.status, 403);
  assertEquals(await denied?.json(), { error: { code: "CORS_ORIGIN_DENIED" } });
});

Deno.test("requireOrganizer verifies the bearer token and resolves its organizer, ignoring body identity", async () => {
  let receivedToken: string | undefined;
  let lookedUpUserId: string | undefined;
  const dependencies: OrganizerAuthDependencies = {
    getUser: (token) => {
      receivedToken = token;
      return Promise.resolve({ user: { id: "auth-user" }, error: null });
    },
    findOrganizerByUserId: (userId) => {
      lookedUpUserId = userId;
      return Promise.resolve({
        organizer: { id: "organizer-owned" },
        error: null,
      });
    },
  };
  const request = new Request("https://functions.example/connect", {
    method: "POST",
    headers: {
      Authorization: "Bearer verified-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: "attacker-user",
      organizerId: "attacker-organizer",
    }),
  });

  const result = await requireOrganizer(request, dependencies);

  assertEquals(receivedToken, "verified-token");
  assertEquals(lookedUpUserId, "auth-user");
  assertEquals(result, { userId: "auth-user", organizerId: "organizer-owned" });
});

Deno.test("requireOrganizer uses authorization-safe 401 and 404 outcomes", async () => {
  const authenticatedWithoutOrganizer: OrganizerAuthDependencies = {
    getUser: () => Promise.resolve({ user: { id: "auth-user" }, error: null }),
    findOrganizerByUserId: () =>
      Promise.resolve({ organizer: null, error: null }),
  };

  const missingBearer = await assertRejects(
    () =>
      requireOrganizer(
        new Request("https://functions.example/connect"),
        authenticatedWithoutOrganizer,
      ),
    HttpError,
  );
  assertEquals(missingBearer.status, 401);
  assertEquals(missingBearer.code, "AUTH_REQUIRED");

  const missingOrganizer = await assertRejects(
    () =>
      requireOrganizer(
        new Request("https://functions.example/connect", {
          headers: { Authorization: "Bearer verified-token" },
        }),
        authenticatedWithoutOrganizer,
      ),
    HttpError,
  );
  assertEquals(missingOrganizer.status, 404);
  assertEquals(missingOrganizer.code, "ORGANIZER_NOT_FOUND");
});

Deno.test("deriveConnectStatus uses Accounts v2 recipient capabilities and requirement ownership", () => {
  const ready = deriveConnectStatus(accountFixture({ id: "acct_ready" }));
  const actionRequired = deriveConnectStatus(accountFixture({
    id: "acct_action",
    transferStatus: "pending",
    payoutStatus: "pending",
    requirements: [
      requirementEntry("user", "currently_due"),
      requirementEntry("user", "past_due"),
    ],
  }));

  assertEquals(ready, {
    transfersStatus: "active",
    payoutsStatus: "active",
    requirementsStatus: "clear",
    requirementsCurrentlyDueCount: 0,
    requirementsPastDueCount: 0,
    lastStatusCode: null,
  });
  assertEquals(actionRequired.requirementsStatus, "action_required");
  assertEquals(actionRequired.requirementsCurrentlyDueCount, 1);
  assertEquals(actionRequired.requirementsPastDueCount, 1);
});

Deno.test("deriveConnectStatus maps unsupported capability state to a safe restricted projection", () => {
  const projection = deriveConnectStatus(accountFixture({
    id: "acct_restricted",
    transferStatus: "unsupported",
    payoutStatus: "restricted",
    transferStatusDetails: [{
      code: "unsupported_country",
      resolution: "contact_stripe",
    }],
  }));

  assertEquals(projection.transfersStatus, "restricted");
  assertEquals(projection.payoutsStatus, "restricted");
  assertEquals(projection.requirementsStatus, "restricted");
  assertEquals(projection.lastStatusCode, "unsupported_country");
});

Deno.test("deriveConnectStatus keeps Stripe-owned due verification pending", () => {
  const projection = deriveConnectStatus(accountFixture({
    id: "acct_verifying",
    requirements: [requirementEntry("stripe", "currently_due")],
  }));

  assertEquals(projection.requirementsStatus, "pending");
});

Deno.test("deriveConnectStatus restricts closed or deactivated recipient accounts", () => {
  for (
    const account of [
      accountFixture({ id: "acct_closed", closed: true }),
      accountFixture({ id: "acct_unapplied", recipientApplied: false }),
      accountFixture({
        id: "acct_notapplied",
        appliedConfigurations: [],
      }),
    ]
  ) {
    assertEquals(deriveConnectStatus(account), {
      transfersStatus: "restricted",
      payoutsStatus: "restricted",
      requirementsStatus: "restricted",
      requirementsCurrentlyDueCount: 0,
      requirementsPastDueCount: 0,
      lastStatusCode: null,
    });
  }
});

Deno.test("deriveConnectStatus rejects malformed or incomplete Accounts v2 shapes", () => {
  const wrongObject = {
    ...accountFixture({ id: "acct_wrong_object" }),
    object: "account",
  };
  const missingCapabilities = accountFixture({ id: "acct_missing_caps" });
  missingCapabilities.configuration = {
    recipient: { applied: true },
  };
  const missingRequirements = accountFixture({
    id: "acct_missing_requirements",
  });
  delete missingRequirements.requirements;
  const invalidStatusDetails = {
    ...accountFixture({ id: "acct_invaliddetail" }),
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              status: "active",
              status_details: [{
                code: "not_a_stripe_status_code",
                resolution: "no_resolution",
              }],
            },
            payouts: { status: "active", status_details: [] },
          },
        },
      },
    },
  };

  for (
    const malformed of [
      wrongObject,
      missingCapabilities,
      missingRequirements,
      invalidStatusDetails,
    ]
  ) {
    const error = assertThrows(() => deriveConnectStatus(malformed), HttpError);
    assertEquals(error.status, 502);
    assertEquals(error.code, "INVALID_STRIPE_ACCOUNT");
  }
});

Deno.test("safeErrorResponse emits stable codes without logging or reflecting sensitive context", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const calls: unknown[][] = [];
  console.error = (...values: unknown[]) => calls.push(values);
  console.log = (...values: unknown[]) => calls.push(values);

  try {
    const known = safeErrorResponse(new HttpError(401, "AUTH_REQUIRED"));
    const unknown = safeErrorResponse(
      new Error(
        "buyer@example.test Authorization: Bearer sensitive-token request-body-secret",
      ),
    );

    assertEquals(known.status, 401);
    assertEquals(await known.json(), { error: { code: "AUTH_REQUIRED" } });
    assertEquals(unknown.status, 500);
    assertEquals(await unknown.json(), { error: { code: "INTERNAL_ERROR" } });
    assertEquals(calls, []);
    assertNotEquals(unknown.headers.get("content-type"), null);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});
