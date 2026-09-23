// deno-lint-ignore-file require-await
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type Stripe from "stripe";
import * as checkoutModule from "./index.ts";
import {
  CheckoutHttpError,
  type CreateCheckoutInput,
  createStripeCreateCheckoutHandler,
  defaultAnonymousRateLimit,
  defaultRefreshConnect,
  hashConfirmationBearer,
  type ReservationSnapshot,
  type StripeCreateCheckoutDependencies,
} from "./index.ts";

const APP_ORIGIN = "https://whereto.example";
const EVENT_ID = "6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe";
const GA_TIER_ID = "11111111-1111-4111-8111-111111111111";
const VIP_TIER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "900a9142-9111-4f87-84d5-b8545a94c7fb";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZER_ID = "44444444-4444-4444-8444-444444444444";
const GA_ORDER_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIP_ORDER_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_ID = "acct_Task4Destination";
const SESSION_ID = "cs_test_Task4Checkout";
const EXPIRES_AT = "2026-08-26T20:30:00.000Z";
const EXPIRES_AT_EPOCH = 1_787_776_200;
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/task4";
const CONNECT_OBSERVED_AT = "2026-08-26T05:00:00.000Z";
const CONFIRMATION_BEARER = "A".repeat(43);
const OTHER_CONFIRMATION_BEARER = `${"A".repeat(42)}Q`;
const CONFIRMATION_HASH =
  "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925";

const validBody = {
  eventId: EVENT_ID,
  buyerName: "Avery Stone",
  buyerEmail: "avery@example.com",
  clientRequestId: REQUEST_ID,
  items: [
    { tierId: VIP_TIER_ID, quantity: 1 },
    { tierId: GA_TIER_ID, quantity: 2 },
  ],
};

const canonicalInput: CreateCheckoutInput = {
  eventId: EVENT_ID,
  buyerName: "Avery Stone",
  buyerEmail: "avery@example.com",
  clientRequestId: REQUEST_ID,
  items: [
    { tierId: GA_TIER_ID, quantity: 2 },
    { tierId: VIP_TIER_ID, quantity: 1 },
  ],
} as unknown as CreateCheckoutInput;

const persistedItems = [
  {
    orderItemId: GA_ORDER_ITEM_ID,
    ticketTierId: GA_TIER_ID,
    tierName: "General Admission",
    unitAmountMinor: 1_500,
    quantity: 2,
    subtotalMinor: 3_000,
    currency: "usd" as const,
  },
  {
    orderItemId: VIP_ORDER_ITEM_ID,
    ticketTierId: VIP_TIER_ID,
    tierName: "VIP Entry",
    unitAmountMinor: 2_500,
    quantity: 1,
    subtotalMinor: 2_500,
    currency: "usd" as const,
  },
];

const TEN_TIER_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
  "00000000-0000-4000-8000-000000000007",
  "00000000-0000-4000-8000-000000000008",
  "00000000-0000-4000-8000-000000000009",
  "00000000-0000-4000-8000-000000000010",
];
const ELEVEN_TIER_IDS = [
  ...TEN_TIER_IDS,
  "00000000-0000-4000-8000-000000000011",
];
const TEN_ORDER_ITEM_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
  "10000000-0000-4000-8000-000000000008",
  "10000000-0000-4000-8000-000000000009",
  "10000000-0000-4000-8000-000000000010",
];
const tenPersistedItems = TEN_TIER_IDS.map((ticketTierId, index) => ({
  orderItemId: TEN_ORDER_ITEM_IDS[index],
  ticketTierId,
  tierName: `Tier ${String(index + 1).padStart(2, "0")}`,
  unitAmountMinor: 101 + index,
  quantity: 1,
  subtotalMinor: 101 + index,
  currency: "usd" as const,
}));

const persistedItemsJsonb =
  `[{"currency": "usd", "quantity": 2, "tier_name": "General Admission", "order_item_id": "${GA_ORDER_ITEM_ID}", "subtotal_minor": 3000, "ticket_tier_id": "${GA_TIER_ID}", "unit_amount_minor": 1500}, {"currency": "usd", "quantity": 1, "tier_name": "VIP Entry", "order_item_id": "${VIP_ORDER_ITEM_ID}", "subtotal_minor": 2500, "ticket_tier_id": "${VIP_TIER_ID}", "unit_amount_minor": 2500}]`;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Hex(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

const CREATE_REQUEST_DIGEST = await sha256Hex([
  "whereto-checkout-cart-v1",
  ORDER_ID,
  EVENT_ID,
  REQUEST_ID,
  CONFIRMATION_HASH,
  "avery@example.com",
  "usd",
  "5500",
  "450",
  ACCOUNT_ID,
  String(EXPIRES_AT_EPOCH),
  "whereto_checkout_cccccccc",
  persistedItemsJsonb,
].join(String.fromCharCode(31)));

function postgresItemsJsonb(
  items: typeof persistedItems,
): string {
  return `[${
    items.map((item) =>
      `{"currency": "usd", "quantity": ${item.quantity}, "tier_name": ${
        JSON.stringify(item.tierName)
      }, "order_item_id": "${item.orderItemId}", "subtotal_minor": ${item.subtotalMinor}, "ticket_tier_id": "${item.ticketTierId}", "unit_amount_minor": ${item.unitAmountMinor}}`
    ).join(", ")
  }]`;
}

const TEN_CREATE_REQUEST_DIGEST = await sha256Hex([
  "whereto-checkout-cart-v1",
  ORDER_ID,
  EVENT_ID,
  REQUEST_ID,
  CONFIRMATION_HASH,
  "avery@example.com",
  "usd",
  "1055",
  "100",
  ACCOUNT_ID,
  String(EXPIRES_AT_EPOCH),
  "whereto_checkout_cccccccc",
  postgresItemsJsonb(tenPersistedItems),
].join(String.fromCharCode(31)));

function request(body: unknown = validBody, options: {
  origin?: string;
  bearer?: string | null;
  method?: string;
  contentType?: string;
  contentLength?: string;
  rawBody?: string;
} = {}): Request {
  const headers = new Headers({
    origin: options.origin ?? APP_ORIGIN,
    "content-type": options.contentType ?? "application/json",
  });
  if (options.bearer !== null) {
    headers.set(
      "X-Whereto-Confirmation-Bearer",
      options.bearer ?? CONFIRMATION_BEARER,
    );
  }
  if (options.contentLength !== undefined) {
    headers.set("content-length", options.contentLength);
  }
  const method = options.method ?? "POST";
  return new Request("https://functions.example/stripe-create-checkout", {
    method,
    headers,
    body: method === "GET" || method === "HEAD"
      ? undefined
      : options.rawBody ?? JSON.stringify(body),
  });
}

function reservation(
  overrides: Partial<ReservationSnapshot> & Record<string, unknown> = {},
): ReservationSnapshot {
  return {
    orderId: ORDER_ID,
    organizerId: ORGANIZER_ID,
    quantity: 3,
    subtotalMinor: 5_500,
    currency: "usd",
    applicationFeeAmountMinor: 450,
    totalMinor: 5_500,
    stripeAccountId: ACCOUNT_ID,
    checkoutExpiresAt: EXPIRES_AT,
    existingCheckoutSessionId: null,
    integrationIdentifier: "whereto_checkout_cccccccc",
    createRequestDigest: CREATE_REQUEST_DIGEST,
    items: structuredClone(persistedItems),
    ...overrides,
  } as ReservationSnapshot;
}

function tenLineReservation(): ReservationSnapshot {
  return reservation({
    quantity: 10,
    subtotalMinor: 1_055,
    applicationFeeAmountMinor: 100,
    totalMinor: 1_055,
    createRequestDigest: TEN_CREATE_REQUEST_DIGEST,
    items: structuredClone(tenPersistedItems),
  });
}

function rpcReservation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    organizer_id: ORGANIZER_ID,
    quantity: 3,
    subtotal_minor: 5_500,
    currency: "usd",
    platform_product_fee_minor: 350,
    stripe_fee_estimate_minor: 100,
    application_fee_amount_minor: 450,
    expected_organizer_proceeds_minor: 5_050,
    total_minor: 5_500,
    stripe_account_id: ACCOUNT_ID,
    checkout_expires_at: EXPIRES_AT,
    existing_checkout_session_id: null,
    integration_identifier: "whereto_checkout_cccccccc",
    create_request_digest: CREATE_REQUEST_DIGEST,
    order_items: persistedItems.map((item) => ({
      order_item_id: item.orderItemId,
      ticket_tier_id: item.ticketTierId,
      tier_name: item.tierName,
      unit_amount_minor: item.unitAmountMinor,
      quantity: item.quantity,
      subtotal_minor: item.subtotalMinor,
      currency: item.currency,
    })),
    ...overrides,
  };
}

function tenLineRpcReservation(): Record<string, unknown> {
  return rpcReservation({
    quantity: 10,
    subtotal_minor: 1_055,
    platform_product_fee_minor: 80,
    stripe_fee_estimate_minor: 20,
    application_fee_amount_minor: 100,
    expected_organizer_proceeds_minor: 955,
    total_minor: 1_055,
    create_request_digest: TEN_CREATE_REQUEST_DIGEST,
    order_items: tenPersistedItems.map((item) => ({
      order_item_id: item.orderItemId,
      ticket_tier_id: item.ticketTierId,
      tier_name: item.tierName,
      unit_amount_minor: item.unitAmountMinor,
      quantity: item.quantity,
      subtotal_minor: item.subtotalMinor,
      currency: item.currency,
    })),
  });
}

function metadata(): Record<string, string> {
  return {
    contract_version: "checkout_integrity_v1",
    event_id: EVENT_ID,
    order_id: ORDER_ID,
  };
}

function productFixture(
  item: (typeof persistedItems)[number],
): Record<string, unknown> {
  return {
    id: `prod_Task4${item.orderItemId.replaceAll("-", "")}`,
    object: "product",
    active: true,
    created: 1_787_773_930,
    default_price: null,
    description: null,
    images: [],
    livemode: false,
    metadata: { whereto_order_item_id: item.orderItemId },
    name: item.tierName,
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: null,
    type: "service",
    unit_label: null,
    updated: 1_787_773_930,
    url: null,
  };
}

function lineFixture(
  item: (typeof persistedItems)[number],
): Record<string, unknown> {
  return {
    id: `li_Task4${item.orderItemId.replaceAll("-", "")}`,
    object: "item",
    amount_discount: 0,
    amount_subtotal: item.subtotalMinor,
    amount_tax: 0,
    amount_total: item.subtotalMinor,
    currency: item.currency,
    description: item.tierName,
    discounts: [],
    price: {
      id: `price_Task4${item.orderItemId.replaceAll("-", "")}`,
      object: "price",
      active: true,
      billing_scheme: "per_unit",
      currency: item.currency,
      livemode: false,
      product: productFixture(item),
      type: "one_time",
      unit_amount: item.unitAmountMinor,
      unit_amount_decimal: String(item.unitAmountMinor),
    },
    quantity: item.quantity,
    taxes: [],
  };
}

function lineItemsFixture(): Record<string, unknown> {
  return {
    object: "list",
    data: persistedItems.map(lineFixture),
    has_more: false,
    url: `/v1/checkout/sessions/${SESSION_ID}/line_items`,
  };
}

function paymentIntentFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pi_Task4Payment",
    object: "payment_intent",
    amount: 5_500,
    amount_capturable: 0,
    amount_received: 0,
    application_fee_amount: 450,
    currency: "usd",
    livemode: false,
    metadata: metadata(),
    status: "requires_payment_method",
    transfer_data: { destination: ACCOUNT_ID },
    ...overrides,
  };
}

function sessionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    status: "open",
    payment_status: "unpaid",
    currency: "usd",
    amount_subtotal: 5_500,
    amount_total: 5_500,
    customer_email: "avery@example.com",
    expires_at: EXPIRES_AT_EPOCH,
    client_reference_id: ORDER_ID,
    success_url: `${APP_ORIGIN}/orders/${CONFIRMATION_BEARER}`,
    cancel_url:
      `${APP_ORIGIN}/events/${EVENT_ID}/checkout?cancel=${CONFIRMATION_BEARER}`,
    integration_identifier: "whereto_checkout_cccccccc",
    metadata: metadata(),
    automatic_tax: { enabled: false },
    url: CHECKOUT_URL,
    line_items: lineItemsFixture(),
    payment_intent: paymentIntentFixture(),
    ...overrides,
  };
}

function readyConnectAccount(): Stripe.V2.Core.Account {
  return {
    id: ACCOUNT_ID,
    object: "v2.core.account",
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
    created: CONNECT_OBSERVED_AT,
    dashboard: "express",
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
}

function dependencies(
  overrides: Partial<StripeCreateCheckoutDependencies> = {},
): StripeCreateCheckoutDependencies {
  return {
    appOrigin: APP_ORIGIN,
    appBaseUrl: APP_ORIGIN,
    rateLimit: async () => ({ allowed: true }),
    refreshConnect: async () => undefined,
    reserveCheckout: async () => reservation(),
    createSession: async () => sessionFixture(),
    retrieveSession: async () => sessionFixture(),
    expireSession: async () => sessionFixture({ status: "expired", url: null }),
    attachSession: async () => undefined,
    releaseReservation: async () => undefined,
    nowEpochSeconds: () => 1_787_773_920,
    operationalSink: () => undefined,
    ...overrides,
  } as StripeCreateCheckoutDependencies;
}

async function responseHasCheckoutUrl(response: Response): Promise<boolean> {
  const body = await response.json();
  return body?.checkoutUrl === CHECKOUT_URL && Object.keys(body).length === 1;
}

// Mutation caught: deriving the bearer from the request UUID, accepting it in
// the body, or hashing the textual base64url form instead of its 32 bytes.
Deno.test("checkout requires an independent canonical 32-byte confirmation bearer", async () => {
  const hashes: string[] = [];
  const deps = dependencies({
    reserveCheckout: async (_input, tokenHash) => {
      hashes.push(tokenHash);
      throw new Error("CHECKOUT_DISABLED");
    },
  });
  const first = await createStripeCreateCheckoutHandler(deps)(request());
  const second = await createStripeCreateCheckoutHandler(deps)(
    request(validBody, {
      bearer: OTHER_CONFIRMATION_BEARER,
    }),
  );
  assertEquals([first.status, second.status], [503, 503]);
  assertEquals(hashes.length, 2);
  assertEquals(hashes[0], CONFIRMATION_HASH);
  assertEquals(hashes[0] !== hashes[1], true);
  await assertRejects(
    () => hashConfirmationBearer(REQUEST_ID),
    CheckoutHttpError,
    "INVALID_REQUEST",
  );
});

// Mutation caught: accepting legacy/unknown keys, malformed carts, or duplicate
// tiers.
Deno.test("checkout rejects non-exact cart request shapes before side effects", async () => {
  const invalidBodies: unknown[] = [
    { ...validBody, extra: true },
    {
      eventId: EVENT_ID,
      buyerName: "Avery Stone",
      buyerEmail: "avery@example.com",
      clientRequestId: REQUEST_ID,
      tierId: GA_TIER_ID,
    },
    { ...validBody, items: [] },
    { ...validBody, items: [{ tierId: GA_TIER_ID, quantity: 0 }] },
    { ...validBody, items: [{ tierId: GA_TIER_ID, quantity: 11 }] },
    { ...validBody, items: [{ tierId: GA_TIER_ID, quantity: 1.5 }] },
    { ...validBody, items: [{ tierId: GA_TIER_ID, quantity: "2" }] },
    {
      ...validBody,
      items: [{ tierId: GA_TIER_ID, quantity: 1 }, {
        tierId: GA_TIER_ID.toUpperCase(),
        quantity: 1,
      }],
    },
    {
      ...validBody,
      items: [{ tierId: GA_TIER_ID, quantity: 1, unitAmountMinor: 1 }],
    },
    { ...validBody, items: [{ tier_id: GA_TIER_ID, quantity: 1 }] },
    { ...validBody, items: [{ tierId: "not-a-uuid", quantity: 1 }] },
    { ...validBody, eventId: "not-a-uuid" },
    { ...validBody, clientRequestId: "6b849fa0-4d5e-1faa-bf31-b169cb1bd7fe" },
    { ...validBody, buyerName: " " },
    { ...validBody, buyerName: "x".repeat(121) },
    { ...validBody, buyerEmail: "not-an-email" },
    { ...validBody, subtotalMinor: 5_500 },
    { ...validBody, stripeAccountId: ACCOUNT_ID },
  ];
  for (const body of invalidBodies) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(request(body));
    assertEquals(response.status, 400);
    assertEquals(touched, false);
  }
});

// Mutation caught: retaining a separate three-line product cap even though ten
// distinct unit-quantity lines satisfy the approved aggregate limit.
Deno.test("checkout accepts and sorts ten distinct request lines", async () => {
  let refreshedTierIds: string[] | undefined;
  let reservedItems: CreateCheckoutInput["items"] | undefined;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    refreshConnect: async (_eventId, tierIds) => {
      refreshedTierIds = tierIds;
    },
    reserveCheckout: async (input) => {
      reservedItems = input.items;
      throw new Error("CHECKOUT_DISABLED");
    },
  }))(request({
    ...validBody,
    items: [...TEN_TIER_IDS].reverse().map((tierId) => ({
      tierId,
      quantity: 1,
    })),
  }));

  assertEquals(response.status, 503);
  assertEquals(refreshedTierIds, TEN_TIER_IDS);
  assertEquals(
    reservedItems,
    TEN_TIER_IDS.map((tierId) => ({ tierId, quantity: 1 })),
  );
});

// Mutation caught: allowing an eleventh distinct line or an aggregate of
// eleven admissions after removing the obsolete three-line cap.
Deno.test("checkout rejects eleven lines and aggregate quantity above ten", async () => {
  const invalidBoundaryCarts = [
    ELEVEN_TIER_IDS.map((tierId) => ({ tierId, quantity: 1 })),
    [
      { tierId: GA_TIER_ID, quantity: 10 },
      { tierId: VIP_TIER_ID, quantity: 1 },
    ],
  ];
  for (const items of invalidBoundaryCarts) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(request({ ...validBody, items }));
    assertEquals(response.status, 400);
    assertEquals(touched, false);
  }
});

// Mutation caught: failing to normalize buyer/UUID data and sort the cart.
Deno.test("checkout normalizes and tier-sorts the cart before side effects", async () => {
  const calls: string[] = [];
  let observedInput: CreateCheckoutInput | undefined;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    refreshConnect: async (eventId, tierIds) => {
      calls.push("refresh");
      assertEquals(eventId, EVENT_ID);
      assertEquals(tierIds as unknown, [GA_TIER_ID, VIP_TIER_ID]);
    },
    reserveCheckout: async (input, tokenHash) => {
      calls.push("reserve");
      observedInput = input;
      assertEquals(tokenHash, CONFIRMATION_HASH);
      return reservation();
    },
    createSession: async () => {
      calls.push("create");
      return sessionFixture();
    },
    attachSession: async () => {
      calls.push("attach");
    },
  }))(request({
    ...validBody,
    eventId: EVENT_ID.toUpperCase(),
    buyerName: "  Avery Stone  ",
    buyerEmail: "  AVERY@EXAMPLE.COM  ",
    clientRequestId: REQUEST_ID.toUpperCase(),
  }));
  assertEquals(response.status, 200);
  assertEquals(calls, ["refresh", "reserve", "create", "attach"]);
  assertEquals(observedInput, canonicalInput);
});

// Mutation caught: accepting a missing, padded, noncanonical, or wrong-sized bearer.
Deno.test("checkout rejects malformed confirmation bearers before side effects", async () => {
  for (
    const bearer of [
      null,
      "A".repeat(42),
      `${CONFIRMATION_BEARER}=`,
      `${"A".repeat(42)}B`,
      `${"A".repeat(42)}+`,
    ]
  ) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(request(validBody, { bearer }));
    assertEquals(response.status, 400);
    assertEquals(touched, false);
  }
  await assertRejects(
    () => hashConfirmationBearer(` ${CONFIRMATION_BEARER}`),
    CheckoutHttpError,
    "INVALID_REQUEST",
  );
});

// Mutation caught: bypassing method, JSON type, declared-byte, or UTF-8 limits.
Deno.test("checkout enforces method content type and the 2048-byte limit", async () => {
  const cases = [
    request(validBody, { method: "GET" }),
    request(validBody, { contentType: "text/plain" }),
    request(validBody, { contentLength: "2049" }),
    request(validBody, { contentLength: "-1" }),
    request(validBody, {
      rawBody: JSON.stringify({ value: "é".repeat(1_100) }),
    }),
  ];
  for (const candidate of cases) {
    let touched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      refreshConnect: async () => {
        touched = true;
      },
    }))(candidate);
    assertEquals(response.status, candidate.method === "GET" ? 405 : 400);
    assertEquals(touched, false);
  }
});

// Mutation caught: forwarding the obsolete singular RPC argument or camelCase cart.
Deno.test("default reservation adapter sends the exact snake-case cart RPC", async () => {
  type ReserveAdapter = (
    input: CreateCheckoutInput,
    tokenHash: string,
    client: unknown,
  ) => Promise<ReservationSnapshot | null>;
  const reserveAdapter =
    (checkoutModule as unknown as { defaultReserveCheckout?: ReserveAdapter })
      .defaultReserveCheckout;
  assertEquals(typeof reserveAdapter, "function");
  if (reserveAdapter === undefined) return;
  let capturedName = "";
  let capturedArgs: Record<string, unknown> | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capturedName = name;
      capturedArgs = args;
      return { data: [rpcReservation()], error: null };
    },
  };
  const result = await reserveAdapter(
    canonicalInput,
    CONFIRMATION_HASH,
    client,
  );
  const expectedArgs = {
    p_event_id: EVENT_ID,
    p_items: [{ tier_id: GA_TIER_ID, quantity: 2 }, {
      tier_id: VIP_TIER_ID,
      quantity: 1,
    }],
    p_name: "Avery Stone",
    p_email: "avery@example.com",
    p_client_request_id: REQUEST_ID,
    p_confirmation_token_hash: CONFIRMATION_HASH,
  };
  assertEquals(capturedName, "server_reserve_checkout");
  assertEquals(
    JSON.stringify(capturedArgs) === JSON.stringify(expectedArgs),
    true,
  );
  assertEquals(result, reservation());
});

// Mutation caught: ignoring an unsafe bigint monetary field merely because the
// Checkout Session builder does not consume that field directly.
Deno.test("default reservation adapter validates every returned bigint", async () => {
  type ReserveAdapter = (
    input: CreateCheckoutInput,
    tokenHash: string,
    client: unknown,
  ) => Promise<ReservationSnapshot | null>;
  const reserveAdapter =
    (checkoutModule as unknown as { defaultReserveCheckout: ReserveAdapter })
      .defaultReserveCheckout;
  for (
    const field of [
      "platform_product_fee_minor",
      "stripe_fee_estimate_minor",
      "expected_organizer_proceeds_minor",
    ]
  ) {
    const client = {
      rpc: async () => ({
        data: [rpcReservation({ [field]: Number.MAX_SAFE_INTEGER + 1 })],
        error: null,
      }),
    };
    await assertRejects(
      () => reserveAdapter(canonicalInput, CONFIRMATION_HASH, client),
      CheckoutHttpError,
      "INTERNAL_ERROR",
    );
  }
});

// Mutation caught: rejecting persisted reservation snapshots solely because
// they contain more than three valid, sorted, aggregate-bounded order items.
Deno.test("default reservation adapter accepts ten persisted order items", async () => {
  type ReserveAdapter = (
    input: CreateCheckoutInput,
    tokenHash: string,
    client: unknown,
  ) => Promise<ReservationSnapshot | null>;
  const reserveAdapter =
    (checkoutModule as unknown as { defaultReserveCheckout: ReserveAdapter })
      .defaultReserveCheckout;
  const input = {
    ...canonicalInput,
    items: TEN_TIER_IDS.map((tierId) => ({ tierId, quantity: 1 })),
  };
  const client = {
    rpc: async () => ({ data: [tenLineRpcReservation()], error: null }),
  };

  const result = await reserveAdapter(input, CONFIRMATION_HASH, client);

  assertEquals(result?.quantity, 10);
  assertEquals(result?.subtotalMinor, 1_055);
  assertEquals(
    result?.items.map((item) => item.orderItemId),
    TEN_ORDER_ITEM_IDS,
  );
  assertEquals(
    result?.items.map((item) => item.ticketTierId),
    TEN_TIER_IDS,
  );
});

// Mutation caught: client-derived/generic lines or wrong metadata, totals, expansion, destination, or key.
Deno.test("checkout creates deterministic Product-bound persisted Stripe lines", async () => {
  let capturedParams: Stripe.Checkout.SessionCreateParams | undefined;
  let capturedOptions: Stripe.RequestOptions | undefined;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    createSession: async (params, options) => {
      capturedParams = params;
      capturedOptions = options;
      return sessionFixture();
    },
  }))(request());
  const expectedParams = {
    mode: "payment",
    customer_email: "avery@example.com",
    expires_at: EXPIRES_AT_EPOCH,
    success_url: `${APP_ORIGIN}/orders/${CONFIRMATION_BEARER}`,
    cancel_url:
      `${APP_ORIGIN}/events/${EVENT_ID}/checkout?cancel=${CONFIRMATION_BEARER}`,
    client_reference_id: ORDER_ID,
    integration_identifier: "whereto_checkout_cccccccc",
    metadata: metadata(),
    payment_intent_data: {
      application_fee_amount: 450,
      transfer_data: { destination: ACCOUNT_ID },
      metadata: metadata(),
    },
    line_items: [
      {
        quantity: 2,
        price_data: {
          currency: "usd",
          unit_amount: 1_500,
          product_data: {
            name: "General Admission",
            metadata: { whereto_order_item_id: GA_ORDER_ITEM_ID },
          },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 2_500,
          product_data: {
            name: "VIP Entry",
            metadata: { whereto_order_item_id: VIP_ORDER_ITEM_ID },
          },
        },
      },
    ],
    expand: ["line_items.data.price.product", "payment_intent"],
  };
  assertEquals(response.status, 200);
  assertEquals(await responseHasCheckoutUrl(response), true);
  assertEquals(
    JSON.stringify(capturedOptions) ===
      JSON.stringify({
        idempotencyKey: `whereto-checkout-integrity-v1:${ORDER_ID}`,
      }),
    true,
  );
  assertEquals(
    JSON.stringify(capturedParams) === JSON.stringify(expectedParams),
    true,
  );
  for (
    const omitted of [
      "payment_method_types",
      "automatic_tax",
      "allow_promotion_codes",
      "discounts",
      "shipping_address_collection",
      "shipping_options",
      "optional_items",
    ]
  ) {
    assertEquals(Object.hasOwn(capturedParams ?? {}, omitted), false);
  }
});

Deno.test("checkout accepts Stripe's documented pre-payment null PaymentIntent", async () => {
  let attached = 0;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    createSession: async () => sessionFixture({ payment_intent: null }),
    attachSession: async () => {
      attached += 1;
    },
  }))(request());

  assertEquals(response.status, 200);
  assertEquals(await responseHasCheckoutUrl(response), true);
  assertEquals(attached, 1);
});

// Mutation caught: truncating a valid ten-line cart during construction or
// validating its returned Stripe lines by position instead of the exact bound set.
Deno.test("checkout constructs and validates ten deterministic bound Stripe lines", async () => {
  let capturedParams: Stripe.Checkout.SessionCreateParams | undefined;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () => tenLineReservation(),
    createSession: async (params) => {
      capturedParams = params;
      return sessionFixture({
        amount_subtotal: 1_055,
        amount_total: 1_055,
        line_items: {
          ...lineItemsFixture(),
          data: [...tenPersistedItems].reverse().map(lineFixture),
        },
        payment_intent: paymentIntentFixture({
          amount: 1_055,
          application_fee_amount: 100,
        }),
      });
    },
  }))(request({
    ...validBody,
    items: [...TEN_TIER_IDS].reverse().map((tierId) => ({
      tierId,
      quantity: 1,
    })),
  }));

  const createdLines = capturedParams?.line_items ?? [];
  const observed = createdLines.map((line) => {
    const priceData = "price_data" in line ? line.price_data : undefined;
    const productData = priceData && "product_data" in priceData
      ? priceData.product_data
      : undefined;
    return {
      quantity: line.quantity,
      unitAmountMinor: priceData && "unit_amount" in priceData
        ? priceData.unit_amount
        : undefined,
      name: productData && "name" in productData ? productData.name : undefined,
      orderItemId: productData && "metadata" in productData
        ? productData.metadata?.whereto_order_item_id
        : undefined,
    };
  });
  const expected = [
    {
      quantity: 1,
      unitAmountMinor: 101,
      name: "Tier 01",
      orderItemId: TEN_ORDER_ITEM_IDS[0],
    },
    {
      quantity: 1,
      unitAmountMinor: 102,
      name: "Tier 02",
      orderItemId: TEN_ORDER_ITEM_IDS[1],
    },
    {
      quantity: 1,
      unitAmountMinor: 103,
      name: "Tier 03",
      orderItemId: TEN_ORDER_ITEM_IDS[2],
    },
    {
      quantity: 1,
      unitAmountMinor: 104,
      name: "Tier 04",
      orderItemId: TEN_ORDER_ITEM_IDS[3],
    },
    {
      quantity: 1,
      unitAmountMinor: 105,
      name: "Tier 05",
      orderItemId: TEN_ORDER_ITEM_IDS[4],
    },
    {
      quantity: 1,
      unitAmountMinor: 106,
      name: "Tier 06",
      orderItemId: TEN_ORDER_ITEM_IDS[5],
    },
    {
      quantity: 1,
      unitAmountMinor: 107,
      name: "Tier 07",
      orderItemId: TEN_ORDER_ITEM_IDS[6],
    },
    {
      quantity: 1,
      unitAmountMinor: 108,
      name: "Tier 08",
      orderItemId: TEN_ORDER_ITEM_IDS[7],
    },
    {
      quantity: 1,
      unitAmountMinor: 109,
      name: "Tier 09",
      orderItemId: TEN_ORDER_ITEM_IDS[8],
    },
    {
      quantity: 1,
      unitAmountMinor: 110,
      name: "Tier 10",
      orderItemId: TEN_ORDER_ITEM_IDS[9],
    },
  ];
  assertEquals(response.status, 200);
  assertEquals(await responseHasCheckoutUrl(response), true);
  assertEquals(observed, expected);
});

// Mutation caught: incomplete retrieval expansion or a second create/attach on retry.
Deno.test("checkout reuses an attached Session after set-based line validation", async () => {
  const calls: string[] = [];
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () =>
      reservation({ existingCheckoutSessionId: SESSION_ID }),
    createSession: async () => {
      throw new Error("must not create");
    },
    retrieveSession: async (sessionId, params) => {
      calls.push("retrieve");
      assertEquals(sessionId, SESSION_ID);
      assertEquals(params, {
        expand: ["line_items.data.price.product", "payment_intent"],
      });
      return sessionFixture({
        line_items: {
          ...lineItemsFixture(),
          data: [...persistedItems].reverse().map(lineFixture),
        },
      });
    },
    attachSession: async () => {
      throw new Error("must not attach");
    },
  }))(request());
  assertEquals(response.status, 200);
  assertEquals(await responseHasCheckoutUrl(response), true);
  assertEquals(calls, ["retrieve"]);
});

// Spec 08: never redirect to an unrelated or terminal attached session.
Deno.test("attached retry requires the exact stored Session ID and open status", async () => {
  for (const override of [
    { id: "cs_test_DifferentSession" },
    { status: "complete" },
    { status: "expired" },
  ]) {
    let creates = 0;
    let attaches = 0;
    let releases = 0;
    let expirations = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () => reservation({ existingCheckoutSessionId: SESSION_ID }),
      retrieveSession: async () => sessionFixture(override),
      createSession: async () => { creates++; return sessionFixture(); },
      attachSession: async () => { attaches++; },
      expireSession: async () => { expirations++; throw new Error("must not expire unrelated or complete truth"); },
      releaseReservation: async () => { releases++; },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(await responseHasCheckoutUrl(response), false);
    assertEquals(creates, 0);
    assertEquals(attaches, 0);
    assertEquals(expirations, 0);
    assertEquals(releases, override.status === "expired" ? 1 : 0);
  }
});

// Mutation caught: releasing or mutating the request after an unknown create outcome.
Deno.test("unknown create outcomes preserve inventory and replay identically", async () => {
  const captured: string[] = [];
  let attempts = 0;
  let releases = 0;
  const deps = dependencies({
    createSession: async (params, options) => {
      captured.push(JSON.stringify({ params, options }));
      attempts += 1;
      if (attempts < 3) throw new TypeError("network connection closed");
      return sessionFixture();
    },
    releaseReservation: async () => {
      releases += 1;
    },
  });
  const first = await createStripeCreateCheckoutHandler(deps)(request());
  const second = await createStripeCreateCheckoutHandler(deps)(request());
  const third = await createStripeCreateCheckoutHandler(deps)(request());
  assertEquals([first.status, second.status, third.status], [502, 502, 200]);
  assertEquals(releases, 0);
  assertEquals(captured.length, 3);
  assertEquals(
    captured[0] === captured[1] && captured[1] === captured[2],
    true,
  );
});

// Mutation caught: retaining inventory after Stripe definitively did not create.
Deno.test("definitive Stripe noncreation releases the reservation", async () => {
  let releases = 0;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    createSession: async () => {
      throw {
        type: "StripeInvalidRequestError",
        rawType: "invalid_request_error",
      };
    },
    releaseReservation: async () => {
      releases += 1;
    },
  }))(request());
  assertEquals(response.status, 502);
  assertEquals(releases, 1);
});

// Mutation caught: positional/name matching or accepting missing, extra,
// duplicate, unexpanded, paginated, or altered bound lines.
Deno.test("checkout rejects every incomplete or conflicting Product-bound line set", async () => {
  const invalidLineLists: Record<string, unknown>[] = [];
  invalidLineLists.push({
    ...lineItemsFixture(),
    data: [lineFixture(persistedItems[0])],
  });
  const extraLine = lineFixture(persistedItems[0]);
  (extraLine.price as Record<string, unknown>).product = {
    ...productFixture(persistedItems[0]),
    metadata: { whereto_order_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  };
  invalidLineLists.push({
    ...lineItemsFixture(),
    data: [...persistedItems.map(lineFixture), extraLine],
  });
  const duplicateLine = lineFixture(persistedItems[1]);
  (duplicateLine.price as Record<string, unknown>).product = productFixture(
    persistedItems[0],
  );
  invalidLineLists.push({
    ...lineItemsFixture(),
    data: [lineFixture(persistedItems[0]), duplicateLine],
  });
  const unexpandedLine = lineFixture(persistedItems[0]);
  (unexpandedLine.price as Record<string, unknown>).product =
    "prod_Task4General";
  invalidLineLists.push({
    ...lineItemsFixture(),
    data: [unexpandedLine, lineFixture(persistedItems[1])],
  });
  const liveNestedLine = lineFixture(persistedItems[0]);
  (liveNestedLine.price as Record<string, unknown>).livemode = true;
  ((liveNestedLine.price as Record<string, unknown>).product as Record<
    string,
    unknown
  >).livemode = true;
  invalidLineLists.push({
    ...lineItemsFixture(),
    data: [liveNestedLine, lineFixture(persistedItems[1])],
  });
  invalidLineLists.push({ ...lineItemsFixture(), has_more: true });
  for (
    const field of [
      "quantity",
      "currency",
      "amount_subtotal",
      "amount_total",
    ] as const
  ) {
    const lines = structuredClone(
      lineItemsFixture().data as Record<string, unknown>[],
    );
    lines[0][field] = field === "currency" ? "eur" : 1;
    invalidLineLists.push({ ...lineItemsFixture(), data: lines });
  }
  for (const field of ["currency", "unit_amount"] as const) {
    const lines = structuredClone(
      lineItemsFixture().data as Record<string, unknown>[],
    );
    (lines[0].price as Record<string, unknown>)[field] = field === "currency"
      ? "eur"
      : 1;
    invalidLineLists.push({ ...lineItemsFixture(), data: lines });
  }
  for (const lineItems of invalidLineLists) {
    let releases = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      createSession: async () => sessionFixture({ line_items: lineItems }),
      releaseReservation: async () => {
        releases += 1;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(releases, 1);
  }
});

// Mutation caught: accepting altered Session/PaymentIntent money, metadata, or destination.
Deno.test("checkout rejects conflicting Session and PaymentIntent aggregates", async () => {
  const invalidSessions = [
    sessionFixture({ amount_subtotal: 5_499 }),
    sessionFixture({ amount_total: 5_499 }),
    sessionFixture({ currency: "eur" }),
    sessionFixture({ metadata: { event_id: EVENT_ID, order_id: ORDER_ID } }),
    sessionFixture({ metadata: { ...metadata(), tier_id: GA_TIER_ID } }),
    sessionFixture({ payment_intent: paymentIntentFixture({ amount: 5_499 }) }),
    sessionFixture({
      payment_intent: paymentIntentFixture({ application_fee_amount: 449 }),
    }),
    sessionFixture({
      payment_intent: paymentIntentFixture({ currency: "eur" }),
    }),
    sessionFixture({
      payment_intent: paymentIntentFixture({
        transfer_data: { destination: "acct_Task4Other" },
      }),
    }),
    sessionFixture({
      payment_intent: paymentIntentFixture({
        metadata: { order_id: ORDER_ID },
      }),
    }),
  ];
  for (const invalid of invalidSessions) {
    let releases = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      createSession: async () => invalid,
      releaseReservation: async () => {
        releases += 1;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(releases, 1);
  }
});

// Mutation caught: releasing inventory while a payable or unverified Session may exist.
Deno.test("checkout releases only after verified expiry", async () => {
  const cases: Array<
    {
      existing?: boolean;
      session: unknown;
      expire: "valid" | "throw" | "wrong";
      releases: number;
    }
  > = [
    {
      session: sessionFixture({ url: "https://attacker.example/checkout" }),
      expire: "valid",
      releases: 1,
    },
    {
      session: sessionFixture({ livemode: true }),
      expire: "valid",
      releases: 0,
    },
    { existing: true, session: undefined, expire: "valid", releases: 0 },
    {
      existing: true,
      session: sessionFixture({ amount_total: 1 }),
      expire: "throw",
      releases: 0,
    },
    {
      existing: true,
      session: sessionFixture({ amount_total: 1 }),
      expire: "wrong",
      releases: 0,
    },
    {
      existing: true,
      session: sessionFixture({ id: "cs_test_OtherCheckout", amount_total: 1 }),
      expire: "valid",
      releases: 0,
    },
    {
      existing: true,
      session: sessionFixture({
        status: "complete",
        payment_status: "paid",
        url: null,
      }),
      expire: "valid",
      releases: 0,
    },
    {
      existing: true,
      session: sessionFixture({ status: "expired", url: null }),
      expire: "valid",
      releases: 1,
    },
  ];
  for (const candidate of cases) {
    let releases = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () =>
        reservation({
          existingCheckoutSessionId: candidate.existing ? SESSION_ID : null,
        }),
      createSession: async () => candidate.session,
      retrieveSession: async () => candidate.session,
      expireSession: async () => {
        if (candidate.expire === "throw") throw new Error("unavailable");
        if (candidate.expire === "wrong") {
          return sessionFixture({
            id: "cs_test_OtherCheckout",
            status: "expired",
            url: null,
          });
        }
        return sessionFixture({ status: "expired", url: null });
      },
      releaseReservation: async () => {
        releases += 1;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(releases, candidate.releases);
  }
});

// Mutation caught: releasing before an attachment failure's Session is expired.
Deno.test("attachment failure expires before releasing inventory", async () => {
  const calls: string[] = [];
  const response = await createStripeCreateCheckoutHandler(dependencies({
    attachSession: async () => {
      calls.push("attach");
      throw new Error("database unavailable");
    },
    expireSession: async (sessionId) => {
      calls.push(`expire:${sessionId}`);
      return sessionFixture({ status: "expired", url: null });
    },
    releaseReservation: async (orderId) => {
      calls.push(`release:${orderId}`);
    },
  }))(request());
  assertEquals(response.status, 500);
  assertEquals(calls, [
    "attach",
    `expire:${SESSION_ID}`,
    `release:${ORDER_ID}`,
  ]);
});

// Mutation caught: returning terminal create results or releasing complete webhook truth.
Deno.test("new terminal Sessions are rejected state-safely", async () => {
  for (
    const [status, paymentStatus, expectedReleases] of [[
      "expired",
      "unpaid",
      1,
    ], ["complete", "paid", 0]] as const
  ) {
    let releases = 0;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      createSession: async () =>
        sessionFixture({
          status,
          payment_status: paymentStatus,
          url: status === "complete" ? null : CHECKOUT_URL,
        }),
      releaseReservation: async () => {
        releases += 1;
      },
    }))(request());
    assertEquals(response.status, 502);
    assertEquals(releases, expectedReleases);
  }
});

// Mutation caught: trusting unsafe bigint values or inconsistent persisted aggregates.
Deno.test("checkout rejects unsafe or inconsistent reservation money", async () => {
  const invalidReservations = [
    reservation({ subtotalMinor: Number.MAX_SAFE_INTEGER + 1 }),
    reservation({ totalMinor: Number.MAX_SAFE_INTEGER + 1 }),
    reservation({ applicationFeeAmountMinor: Number.MAX_SAFE_INTEGER + 1 }),
    reservation({ quantity: 4 }),
    reservation({ totalMinor: 5_499 }),
    reservation(
      {
        items: [{
          ...persistedItems[0],
          unitAmountMinor: Number.MAX_SAFE_INTEGER + 1,
        }, persistedItems[1]],
      } as Partial<ReservationSnapshot>,
    ),
    reservation(
      {
        items: [
          { ...persistedItems[0], subtotalMinor: 2_999 },
          persistedItems[1],
        ],
      } as Partial<ReservationSnapshot>,
    ),
  ];
  for (const invalid of invalidReservations) {
    let stripeTouched = false;
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () => invalid,
      createSession: async () => {
        stripeTouched = true;
        return sessionFixture();
      },
    }))(request());
    assertEquals(response.status, 500);
    assertEquals(stripeTouched, false);
  }
});

// Mutation caught: ignoring corruption in the immutable cart create digest.
Deno.test("checkout rejects a corrupted cart digest before Stripe", async () => {
  let stripeTouched = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () =>
      reservation({ createRequestDigest: "a".repeat(64) }),
    createSession: async () => {
      stripeTouched = true;
      return sessionFixture();
    },
  }))(request());
  assertEquals(response.status, 500);
  assertEquals(stripeTouched, false);
});

// Mutation caught: creating after the persisted minimum Stripe lifetime window.
Deno.test("old pre-attach reservations expire without Stripe or release", async () => {
  let stripeTouched = false;
  let released = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    nowEpochSeconds: () => 1_787_774_161,
    createSession: async () => {
      stripeTouched = true;
      return sessionFixture();
    },
    releaseReservation: async () => {
      released = true;
    },
  }))(request());
  assertEquals(response.status, 410);
  assertEquals(stripeTouched, false);
  assertEquals(released, false);
});

// Mutation caught: collapsing approved public reservation outcomes.
Deno.test("checkout preserves approved safe reservation error codes", async () => {
  for (
    const [databaseCode, status, responseCode] of [
      ["CHECKOUT_DISABLED", 503, "CHECKOUT_DISABLED"],
      ["IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT"],
      ["EVENT_NOT_SELLABLE", 409, "EVENT_NOT_SELLABLE"],
      ["TIER_NOT_ACTIVE", 409, "TIER_NOT_ACTIVE"],
      ["TIER_NOT_FOUND", 409, "TIER_NOT_FOUND"],
      ["TIER_SOLD_OUT", 409, "TIER_SOLD_OUT"],
      ["CONNECT_ACTION_REQUIRED", 409, "CONNECT_ACTION_REQUIRED"],
      ["FEE_RULE_NOT_CONFIGURED", 503, "CHECKOUT_UNAVAILABLE"],
    ] as const
  ) {
    const response = await createStripeCreateCheckoutHandler(dependencies({
      reserveCheckout: async () => {
        throw new Error(databaseCode);
      },
    }))(request());
    assertEquals(response.status, status);
    assertEquals((await response.json()).error.code, responseCode);
  }
});

// Mutation caught: checking only one tier in the current Connect preflight.
Deno.test("default Connect preflight checks the complete sorted tier set", async () => {
  let capturedArgs: Record<string, unknown> | undefined;
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      capturedArgs = args;
      return {
        data: [{ organizer_id: ORGANIZER_ID, stripe_account_id: ACCOUNT_ID }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof defaultRefreshConnect>[2];
  const runtime = {
    repository: {
      findAccount: async () => ACCOUNT_ID,
      beginRefresh: async () => 301,
      persistStatus: async () => ({
        outcome: "updated" as const,
        syncedAt: CONNECT_OBSERVED_AT,
      }),
    },
    retrieveAccount: async () => readyConnectAccount(),
  };
  const refresh = defaultRefreshConnect as unknown as (
    eventId: string,
    tierIds: string[],
    client: unknown,
    runtime: unknown,
  ) => Promise<void>;
  await refresh(EVENT_ID, [GA_TIER_ID, VIP_TIER_ID], client, runtime);
  assertEquals(capturedArgs, {
    p_event_id: EVENT_ID,
    p_tier_ids: [GA_TIER_ID, VIP_TIER_ID],
  });
});

// Mutation caught: leaking upstream details in the response.
Deno.test("checkout suppresses buyer and upstream details", async () => {
  const response = await createStripeCreateCheckoutHandler(dependencies({
    reserveCheckout: async () => {
      throw new Error("password=synthetic-sensitive-detail");
    },
  }))(request());
  const raw = await response.text();
  assertEquals(response.status, 500);
  assertEquals(raw, '{"error":{"code":"INTERNAL_ERROR"}}');
  assertEquals(raw.includes("synthetic-sensitive-detail"), false);
  assertStringIncludes(response.headers.get("cache-control") ?? "", "no-store");
});

Deno.test("checkout emits stage-specific sanitized provider outcomes", async () => {
  const records: Array<Record<string, unknown>> = [];
  const operationalSink = (serialized: string) => {
    records.push(JSON.parse(serialized));
  };

  const created = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
  }))(request());
  const reused = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
    reserveCheckout: async () =>
      reservation({ existingCheckoutSessionId: SESSION_ID }),
  }))(request());
  const failed = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
    createSession: async () => {
      throw { type: "StripeInvalidRequestError" };
    },
  }))(request());
  const uncertain = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
    createSession: async () => {
      throw new TypeError("fixture connection closed");
    },
  }))(request());
  const network = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
    createSession: async () => {
      throw { type: "StripeConnectionError" };
    },
  }))(request());
  const invalidResponse = await createStripeCreateCheckoutHandler(dependencies({
    operationalSink,
    createSession: async () => sessionFixture({ amount_total: 5_499 }),
  }))(request());

  assertEquals(
    [
      created.status,
      reused.status,
      failed.status,
      uncertain.status,
      network.status,
      invalidResponse.status,
    ],
    [200, 200, 502, 502, 502, 502],
  );
  assertEquals(records, [
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "created",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      providerObjectId: SESSION_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      resultStatus: "checkout_open",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "reused",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      providerObjectId: SESSION_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      priorStatus: "checkout_open",
      resultStatus: "checkout_open",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "failed",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      errorCode: "STRIPE_REQUEST_FAILED",
      failureStage: "stripe_session_creation",
      providerResult: "provider_error_response",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "uncertain",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      errorCode: "STRIPE_REQUEST_FAILED",
      failureStage: "stripe_session_creation",
      providerResult: "runtime_failure",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "uncertain",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      errorCode: "STRIPE_REQUEST_FAILED",
      failureStage: "stripe_session_creation",
      providerResult: "network_failure",
    },
    {
      contractVersion: "checkout_integrity_v1",
      operation: "checkout.create",
      outcome: "failed",
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      providerObjectId: SESSION_ID,
      itemCount: 2,
      aggregateQuantity: 3,
      currency: "usd",
      subtotalMinor: 5_500,
      totalMinor: 5_500,
      applicationFeeAmountMinor: 450,
      errorCode: "INVALID_STRIPE_SESSION",
      failureStage: "stripe_session_response",
      providerResult: "session_returned",
    },
  ]);
});

Deno.test("post-create checkout failures are uncertain unless expiry and release both complete", async () => {
  const cases: Array<{
    name: string;
    overrides: Partial<StripeCreateCheckoutDependencies>;
    expectedOutcome: "failed" | "uncertain";
  }> = [
    {
      name: "invalid session with verified cleanup",
      overrides: {
        createSession: async () =>
          sessionFixture({ url: "https://attacker.example/checkout" }),
      },
      expectedOutcome: "failed",
    },
    {
      name: "invalid session without trustworthy cleanup identity",
      overrides: {
        createSession: async () => sessionFixture({ livemode: true }),
      },
      expectedOutcome: "uncertain",
    },
    {
      name: "complete session owned by webhook",
      overrides: {
        createSession: async () =>
          sessionFixture({
            status: "complete",
            payment_status: "paid",
            url: null,
          }),
      },
      expectedOutcome: "uncertain",
    },
    {
      name: "attachment failure with expiration failure",
      overrides: {
        attachSession: async () => {
          throw new Error("fixture database unavailable");
        },
        expireSession: async () => {
          throw new Error("fixture Stripe unavailable");
        },
      },
      expectedOutcome: "uncertain",
    },
    {
      name: "attachment failure with invalid expiration evidence",
      overrides: {
        attachSession: async () => {
          throw new Error("fixture database unavailable");
        },
        expireSession: async () =>
          sessionFixture({ id: "cs_test_DifferentSession", status: "expired" }),
      },
      expectedOutcome: "uncertain",
    },
    {
      name: "verified expiration followed by release failure",
      overrides: {
        attachSession: async () => {
          throw new Error("fixture database unavailable");
        },
        releaseReservation: async () => {
          throw new Error("fixture database unavailable");
        },
      },
      expectedOutcome: "uncertain",
    },
    {
      name: "expired session followed by completed release",
      overrides: {
        createSession: async () =>
          sessionFixture({ status: "expired", url: null }),
      },
      expectedOutcome: "failed",
    },
  ];

  for (const testCase of cases) {
    const records: Array<Record<string, unknown>> = [];
    const response = await createStripeCreateCheckoutHandler(dependencies({
      ...testCase.overrides,
      operationalSink: (serialized) => records.push(JSON.parse(serialized)),
    }))(request());
    assertEquals(response.status >= 500, true, testCase.name);
    assertEquals(records.length, 1, testCase.name);
    assertEquals(records[0].operation, "checkout.create", testCase.name);
    assertEquals(records[0].outcome, testCase.expectedOutcome, testCase.name);
  }
});

// Mutation caught: sibling origins or omission of the Checkout bearer header.
Deno.test("checkout keeps exact-origin CORS and allows the bearer header", async () => {
  const handler = createStripeCreateCheckoutHandler(dependencies());
  const preflight = await handler(
    new Request("https://functions.example/stripe-create-checkout", {
      method: "OPTIONS",
      headers: { origin: APP_ORIGIN },
    }),
  );
  assertEquals(preflight.status, 204);
  assertEquals(
    preflight.headers.get("access-control-allow-headers"),
    "authorization, content-type, x-client-info, apikey, x-whereto-confirmation-bearer, x-wheretoo-storefront",
  );
  let touched = false;
  const denied = await createStripeCreateCheckoutHandler(dependencies({
    rateLimit: async () => {
      touched = true;
      return { allowed: true };
    },
  }))(request(validBody, { origin: `${APP_ORIGIN}.attacker.test` }));
  assertEquals(denied.status, 403);
  assertEquals(touched, false);
});

// Mutation caught: moving rate limiting after buyer/cart parsing.
Deno.test("checkout rate-limits before parsing buyer data", async () => {
  let refreshed = false;
  const response = await createStripeCreateCheckoutHandler(dependencies({
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 37 }),
    refreshConnect: async () => {
      refreshed = true;
    },
  }))(request({ secretBuyerField: "must-not-be-read" }));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("retry-after"), "37");
  assertEquals(refreshed, false);
});

// Mutation caught: forwarding the raw caller identity to the limiter.
Deno.test("default anonymous limiter hashes caller identity", async () => {
  let capturedName = "";
  let capturedArgs: Record<string, unknown> | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      capturedName = name;
      capturedArgs = args;
      return {
        data: [{ allowed: false, retry_after_seconds: 23 }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof defaultAnonymousRateLimit>[1];
  const result = await defaultAnonymousRateLimit(
    new Request(
      "https://functions.example/stripe-create-checkout",
      { headers: { "cf-connecting-ip": "203.0.113.9" } },
    ),
    client,
  );
  assertEquals(capturedName, "server_consume_checkout_rate_limit");
  assertEquals(
    /^[a-f0-9]{64}$/.test(String(capturedArgs?.p_identity_hash)),
    true,
  );
  assertEquals(JSON.stringify(capturedArgs).includes("203.0.113.9"), false);
  assertEquals(result, { allowed: false, retryAfterSeconds: 23 });
});

Deno.test("optional storefront measurement failure never rejects canonical checkout", async () => {
  const response = await createStripeCreateCheckoutHandler(dependencies({
    associateStorefront: async () => { throw new Error("measurement unavailable"); },
  }))(request());
  assertEquals(response.status, 200);
  assertEquals(await responseHasCheckoutUrl(response), true);
});
