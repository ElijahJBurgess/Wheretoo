import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { type OrganizerAuthDependencies, requireOrganizer } from "./auth.ts";
import { getCorsHeaders, handleCorsPreflight } from "./cors.ts";
import { deriveConnectStatus } from "./connectState.ts";
import { validateStripeRestrictedKey } from "./env.ts";
import { HttpError } from "./http.ts";
import {
  getStripe,
  rejectLiveStripeObject,
  STRIPE_API_VERSION,
} from "./stripeClient.ts";
import { safeErrorResponse } from "./stripeErrors.ts";

const TEST_APP_ORIGIN = "https://whereto.example";

function testRestrictedKey(): string {
  return ["rk", "test", "unitboundary123"].join("_");
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

Deno.test("getStripe returns one test-key client pinned to the approved API version", () => {
  const previous = Deno.env.get("STRIPE_RESTRICTED_KEY");
  Deno.env.set("STRIPE_RESTRICTED_KEY", testRestrictedKey());

  try {
    const first = getStripe();
    const second = getStripe();

    assertStrictEquals(first, second);
    assertEquals(first.getApiField("version"), "2026-07-29.dahlia");
    assertEquals(STRIPE_API_VERSION, "2026-07-29.dahlia");
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
  const ready = deriveConnectStatus({
    id: "acct_ready",
    livemode: false,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "active", status_details: [] },
          },
        },
      },
    },
    requirements: { entries: [] },
  });
  const actionRequired = deriveConnectStatus({
    id: "acct_action",
    livemode: false,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "pending", status_details: [] },
            payouts: { status: "pending", status_details: [] },
          },
        },
      },
    },
    requirements: {
      entries: [
        {
          awaiting_action_from: "user",
          minimum_deadline: { status: "currently_due" },
        },
        {
          awaiting_action_from: "user",
          minimum_deadline: { status: "past_due" },
        },
      ],
    },
  });

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
  const projection = deriveConnectStatus({
    id: "acct_restricted",
    livemode: false,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              status: "unsupported",
              status_details: [{
                code: "unsupported_country",
                resolution: "contact_stripe",
              }],
            },
            payouts: { status: "restricted", status_details: [] },
          },
        },
      },
    },
    requirements: { entries: [] },
  });

  assertEquals(projection.transfersStatus, "restricted");
  assertEquals(projection.payoutsStatus, "restricted");
  assertEquals(projection.requirementsStatus, "restricted");
  assertEquals(projection.lastStatusCode, "unsupported_country");
});

Deno.test("deriveConnectStatus keeps Stripe-owned due verification pending", () => {
  const projection = deriveConnectStatus({
    id: "acct_verifying",
    livemode: false,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: { status: "active", status_details: [] },
          },
        },
      },
    },
    requirements: {
      entries: [{
        awaiting_action_from: "stripe",
        minimum_deadline: { status: "currently_due" },
      }],
    },
  });

  assertEquals(projection.requirementsStatus, "pending");
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
