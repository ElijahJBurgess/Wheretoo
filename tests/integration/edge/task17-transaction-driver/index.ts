// The runner rewrites only this source's repository-relative import prefix
// while materializing it under supabase/functions, then removes the function,
// source, and secrets from its EXIT trap.
import type Stripe from "stripe";
import { getServiceClient } from "../../../../supabase/functions/_shared/database.ts";
import {
  getStripeWebhookSecret,
  getSupabaseServiceConfig,
} from "../../../../supabase/functions/_shared/env.ts";
import { createWholeOrderRefund } from "../../../../supabase/functions/_shared/refundOrder.ts";
import { getStripe } from "../../../../supabase/functions/_shared/stripeClient.ts";
import {
  ACCOUNT_INCLUDE,
  toSafeConnectStatus,
  validateApprovedConnectAccount,
} from "../../../../supabase/functions/stripe-connect-session/connect.ts";
import {
  createDefaultStripeWebhookDependencies,
  createStripeWebhookHandler,
} from "../../../../supabase/functions/stripe-webhook/index.ts";
import {
  applyDiagnosticAccountCleanup,
  assertSafeProofResponse,
  deleteAndVerifyFixtureAuthUser,
  destinationChargeRelationsMatch,
  findExactFixtureAuthUser,
  retrieveAccountForDiagnostic,
  validateAccountForDiagnostic,
} from "./contracts.ts";

const actions = new Set([
  "account_diagnostic",
  "server_proof",
  "setup",
  "inspect",
  "checkout_status",
  "deliver",
  "deliver_transient_retry",
  "expire_checkout",
  "invalid_signature",
  "reconcile_payment",
  "reconcile_events",
  "create_refund",
  "cleanup",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fixtureTiers = [
  {
    label: "ga",
    name: "Task 17 General Admission",
    unitAmountMinor: 1_500,
    quantity: 2,
    subtotalMinor: 3_000,
    quantityTotal: 10,
    sortOrder: 1,
  },
  {
    label: "vip",
    name: "Task 17 VIP",
    unitAmountMinor: 2_500,
    quantity: 1,
    subtotalMinor: 2_500,
    quantityTotal: 10,
    sortOrder: 2,
  },
] as const;
const fixtureQuantity = 3;
const fixtureSubtotalMinor = 5_500;
const fixtureApplicationFeeMinor = 425;
const fixtureOrganizerProceedsMinor = 5_075;
type OrderHandle = "paid" | "declined";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(assertSafeProofResponse(body)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function orderHandle(value: unknown): OrderHandle {
  if (value !== "paid" && value !== "declined") throw new Error("INPUT");
  return value;
}

function fixtureBuyerEmail(handle: OrderHandle): string {
  return `${fixturePrefix()}-${handle}@example.invalid`;
}

function buyerOrderHandle(value: unknown): OrderHandle {
  if (value === fixtureBuyerEmail("paid")) return "paid";
  if (value === fixtureBuyerEmail("declined")) return "declined";
  throw new Error("DATABASE");
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.length === 0) throw new Error("CONFIG");
  return value;
}

function fixturePrefix(): string {
  const value = env("TASK17_FIXTURE_PREFIX");
  if (!/^task17_[a-z0-9]{12}$/.test(value)) throw new Error("CONFIG");
  return value;
}

function connectedAccountId(): string {
  const value = env("TASK17_CONNECTED_ACCOUNT_ID");
  if (!/^acct_[A-Za-z0-9]+$/.test(value)) throw new Error("CONFIG");
  return value;
}

function mustCloseConnectedAccount(): void {
  if (env("TASK17_CLOSE_CONNECTED_ACCOUNT") !== "true") {
    throw new Error("CONFIG");
  }
}

function authorized(request: Request): boolean {
  const expected = env("TASK17_PROOF_TOKEN");
  const supplied = request.headers.get("x-task17-proof-token");
  if (supplied === null || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

async function signPayload(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1_000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getStripeWebhookSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return `t=${timestamp},v1=${hex(signature)}`;
}

type EventDescriptor = {
  event_id: string;
  type:
    | "checkout.session.completed"
    | "checkout.session.expired"
    | "refund.updated";
  object: "checkout.session" | "refund";
  object_id: string;
  created: number;
};

async function eventDescriptor(value: unknown): Promise<EventDescriptor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INPUT");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "created,event_handle,object,order_handle,type") {
    throw new Error("INPUT");
  }
  if (
    typeof row.event_handle !== "string" ||
    !uuidPattern.test(row.event_handle) ||
    !Number.isSafeInteger(row.created) ||
    Math.abs(Math.floor(Date.now() / 1_000) - (row.created as number)) > 300
  ) throw new Error("INPUT");
  const handle = orderHandle(row.order_handle);
  const order = await proofOrder(handle);
  const valid = (
    row.type === "checkout.session.completed" &&
    row.object === "checkout.session"
  ) || (
    row.type === "checkout.session.expired" &&
    row.object === "checkout.session"
  ) || (
    row.type === "refund.updated" && row.object === "refund"
  );
  if (!valid) throw new Error("INPUT");
  let objectId = order.stripe_checkout_session_id;
  if (row.object === "refund") {
    const { data, error } = await getServiceClient().from("refunds")
      .select("stripe_refund_id").eq("order_id", order.id).single();
    if (error !== null) throw new Error("DATABASE");
    objectId = data.stripe_refund_id;
  }
  if (typeof objectId !== "string") throw new Error("DATABASE");
  return {
    event_id: `evt_task17${row.event_handle.replaceAll("-", "")}`,
    type: row.type as EventDescriptor["type"],
    object: row.object as EventDescriptor["object"],
    object_id: objectId,
    created: row.created as number,
  };
}

function eventPayload(event: EventDescriptor): string {
  return JSON.stringify({
    id: event.event_id,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: event.created,
    livemode: false,
    type: event.type,
    data: { object: { id: event.object_id, object: event.object } },
  });
}

async function signedRequest(event: EventDescriptor): Promise<Request> {
  const payload = eventPayload(event);
  return new Request(
    `${getSupabaseServiceConfig().url}/functions/v1/stripe-webhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await signPayload(payload),
      },
      body: payload,
    },
  );
}

async function receipt(eventId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getServiceClient().from("stripe_webhook_events")
    .select(
      "stripe_event_id,event_type,stripe_object_id,processing_status,delivery_attempt_count,error_code",
    ).eq("stripe_event_id", eventId).single();
  if (error !== null) throw new Error("DATABASE");
  return {
    event_type: data.event_type,
    processing_status: data.processing_status,
    delivery_attempt_count: data.delivery_attempt_count,
    error_code: data.error_code,
  };
}

async function serverProof(): Promise<Record<string, unknown>> {
  const stripe = getStripe();
  const accountId = connectedAccountId();
  const retrieved = await retrieveAccountForDiagnostic(() =>
    stripe.v2.core.accounts.retrieve(accountId, { include: ACCOUNT_INCLUDE })
  );
  if (!retrieved.ok) return retrieved;
  const account = retrieved.account;
  if (account.livemode !== false || account.id !== accountId) {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
  const validated = validateAccountForDiagnostic(
    account,
    validateApprovedConnectAccount,
  );
  if (!validated.ok) return validated;
  const projection = validated.projection;
  const safe = toSafeConnectStatus(projection, new Date().toISOString());
  const proofPayload = JSON.stringify({
    id: `evt_task17proof${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    type: "task17.proof",
    data: { object: { id: accountId, object: "v2.core.account" } },
  });
  const verified = await stripe.webhooks.constructEventAsync(
    proofPayload,
    await signPayload(proofPayload),
    getStripeWebhookSecret(),
  );
  return {
    ok: safe.status === "ready" && verified.livemode === false,
    restricted_key_authenticated: true,
    webhook_signature_verified: verified.id.startsWith("evt_task17proof"),
    livemode: account.livemode,
    connected_account_matches: account.id === accountId,
    transfers_status: projection.transfersStatus,
    payouts_status: projection.payoutsStatus,
    requirements_status: projection.requirementsStatus,
  };
}

async function fixtureOrganizer(): Promise<{ id: string } | null> {
  const { data, error } = await getServiceClient().from("organizers").select(
    "id",
  )
    .eq("display_name", fixturePrefix()).maybeSingle();
  if (error !== null) throw new Error("DATABASE");
  return data;
}

type FixtureAuthIdentity = { id: string; email: string };

async function loadFixtureAuthUserById(
  id: string,
): Promise<FixtureAuthIdentity | null> {
  const result = await getServiceClient().auth.admin.getUserById(id);
  if (result.error !== null) {
    if (result.error.status === 404) return null;
    throw new Error("DATABASE");
  }
  if (result.data.user.email === undefined) throw new Error("DATABASE");
  return { id: result.data.user.id, email: result.data.user.email };
}

async function loadFixtureAuthPage(page: number) {
  const result = await getServiceClient().auth.admin.listUsers({
    page,
    perPage: 1_000,
  });
  if (result.error !== null) throw new Error("DATABASE");
  return {
    users: result.data.users.map((user) => ({
      id: user.id,
      email: user.email,
    })),
    nextPage: result.data.nextPage,
  };
}

async function fixtureAuthUser(
  preferredId?: string,
): Promise<FixtureAuthIdentity | null> {
  const expectedEmail = `${fixturePrefix()}@example.invalid`;
  if (preferredId !== undefined) {
    const exact = await loadFixtureAuthUserById(preferredId);
    if (exact !== null) {
      if (exact.email !== expectedEmail) throw new Error("DATABASE");
      return exact;
    }
  }
  const found = await findExactFixtureAuthUser(
    expectedEmail,
    loadFixtureAuthPage,
  );
  if (found === null) return null;
  if (preferredId !== undefined && found.id !== preferredId) {
    throw new Error("DATABASE");
  }
  return { id: found.id, email: expectedEmail };
}

async function setup(): Promise<Record<string, unknown>> {
  const proof = await serverProof();
  if (proof.ok !== true) throw new Error("STRIPE");
  const client = getServiceClient();
  let organizer = await fixtureOrganizer();
  if (organizer === null) {
    const existingAuth = await fixtureAuthUser();
    if (existingAuth === null) {
      const auth = await client.auth.admin.createUser({
        email: `${fixturePrefix()}@example.invalid`,
        password: `${crypto.randomUUID()}Aa1!`,
        email_confirm: true,
      });
      if (auth.error !== null) throw new Error("DATABASE");
      organizer = { id: auth.data.user.id };
    } else {
      organizer = existingAuth;
    }
    const { error: organizerError } = await client.from("organizers").insert({
      id: organizer.id,
      display_name: fixturePrefix(),
    });
    if (organizerError !== null) throw new Error("DATABASE");
    const projection = validateApprovedConnectAccount(
      await getStripe().v2.core.accounts.retrieve(connectedAccountId(), {
        include: ACCOUNT_INCLUDE,
      }),
    );
    const { error: connectError } = await client.from(
      "organizer_stripe_accounts",
    ).insert({
      organizer_id: organizer.id,
      stripe_account_id: connectedAccountId(),
      transfers_status: projection.transfersStatus,
      payouts_status: projection.payoutsStatus,
      requirements_status: projection.requirementsStatus,
      requirements_currently_due_count:
        projection.requirementsCurrentlyDueCount,
      requirements_past_due_count: projection.requirementsPastDueCount,
      last_status_code: projection.lastStatusCode,
    });
    if (connectError !== null) throw new Error("DATABASE");
  } else if (await fixtureAuthUser(organizer.id) === null) {
    throw new Error("DATABASE");
  }

  const title = `${fixturePrefix()} transaction`;
  const eventRead = await client.from("events")
    .select("id")
    .eq("organizer_id", organizer.id).eq("title", title).maybeSingle();
  if (eventRead.error !== null) throw new Error("DATABASE");
  let event = eventRead.data;
  if (event === null) {
    const eventId = crypto.randomUUID();
    const startsAt = new Date(Date.now() + 7 * 86_400_000);
    const { error } = await client.from("events").insert({
      id: eventId,
      organizer_id: organizer.id,
      status: "published",
      moderation_status: "clear",
      title,
      description: "Disposable real Stripe test-mode transaction fixture.",
      category: "music",
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 14_400_000).toISOString(),
      timezone: "America/Los_Angeles",
      venue_name: "Task 17 Test Venue",
      address_line1: "123 Test Street",
      city: "San Francisco",
      region: "CA",
      postal_code: "94103",
      country_code: "US",
      latitude: 37.7749,
      longitude: -122.4194,
      admission_type: "paid",
      capacity: 10,
      published_at: new Date().toISOString(),
    });
    if (error !== null) throw new Error("DATABASE");
    event = { id: eventId };
  }
  const tiers: Array<{
    label: "ga" | "vip";
    id: string;
    name: string;
    unitAmountMinor: number;
    quantity: number;
    subtotalMinor: number;
  }> = [];
  for (const definition of fixtureTiers) {
    const tierRead = await client.from("ticket_tiers")
      .select(
        "id,name,unit_amount_minor,currency,quantity_total,status,sort_order",
      )
      .eq("event_id", event.id).eq("sort_order", definition.sortOrder)
      .maybeSingle();
    if (tierRead.error !== null) throw new Error("DATABASE");
    let tier = tierRead.data;
    if (tier === null) {
      const tierId = crypto.randomUUID();
      const { error } = await client.from("ticket_tiers").insert({
        id: tierId,
        event_id: event.id,
        name: definition.name,
        unit_amount_minor: definition.unitAmountMinor,
        currency: "usd",
        quantity_total: definition.quantityTotal,
        status: "active",
        sort_order: definition.sortOrder,
      });
      if (error !== null) throw new Error("DATABASE");
      tier = {
        id: tierId,
        name: definition.name,
        unit_amount_minor: definition.unitAmountMinor,
        currency: "usd",
        quantity_total: definition.quantityTotal,
        status: "active",
        sort_order: definition.sortOrder,
      };
    }
    if (
      tier.name !== definition.name ||
      tier.unit_amount_minor !== definition.unitAmountMinor ||
      tier.currency !== "usd" ||
      tier.quantity_total !== definition.quantityTotal ||
      tier.status !== "active" || tier.sort_order !== definition.sortOrder
    ) throw new Error("DATABASE");
    tiers.push({
      label: definition.label,
      id: tier.id,
      name: definition.name,
      unitAmountMinor: definition.unitAmountMinor,
      quantity: definition.quantity,
      subtotalMinor: definition.subtotalMinor,
    });
  }
  const gaTier = tiers.find((tier) => tier.label === "ga");
  const vipTier = tiers.find((tier) => tier.label === "vip");
  if (gaTier === undefined || vipTier === undefined) {
    throw new Error("DATABASE");
  }
  return {
    ok: true,
    event_id: event.id,
    ga_tier_id: gaTier.id,
    vip_tier_id: vipTier.id,
    items: tiers.map((tier) => ({
      label: tier.label,
      tier_id: tier.id,
      name: tier.name,
      unit_amount_minor: tier.unitAmountMinor,
      quantity: tier.quantity,
      subtotal_minor: tier.subtotalMinor,
      currency: "usd",
    })),
    quantity: fixtureQuantity,
    subtotal_minor: fixtureSubtotalMinor,
    total_minor: fixtureSubtotalMinor,
    application_fee_minor: fixtureApplicationFeeMinor,
    organizer_proceeds_minor: fixtureOrganizerProceedsMinor,
  };
}

async function inspect(eventId: unknown): Promise<Record<string, unknown>> {
  if (typeof eventId !== "string" || !uuidPattern.test(eventId)) {
    throw new Error("INPUT");
  }
  const client = getServiceClient();
  const { data: orders, error: orderError } = await client.from("orders")
    .select(
      "id,buyer_email,status,failure_code,reconciliation_status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_transfer_id,stripe_application_fee_id,stripe_balance_transaction_id,subtotal_minor,total_minor,application_fee_amount_minor,expected_organizer_proceeds_minor",
    ).eq("event_id", eventId).order("created_at", { ascending: true });
  if (orderError !== null) throw new Error("DATABASE");
  const handlesByOrderId = new Map<string, OrderHandle>();
  const seenHandles = new Set<OrderHandle>();
  for (const order of orders) {
    const handle = buyerOrderHandle(order.buyer_email);
    if (seenHandles.has(handle)) throw new Error("DATABASE");
    seenHandles.add(handle);
    handlesByOrderId.set(order.id, handle);
  }
  const orderIds = orders.map((order) => order.id);
  const itemResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("order_items").select(
      "id,order_id,ticket_tier_id,tier_name,unit_amount_minor,quantity,subtotal_minor,currency",
    )
      .in("order_id", orderIds);
  const ticketResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("tickets").select(
      "id,order_id,order_item_id,ticket_tier_id,unit_sequence,status,refunded_at",
    ).in("order_id", orderIds);
  const refundResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("refunds").select(
      "id,order_id,stripe_refund_id,status,amount_minor,stripe_transfer_reversal_id,stripe_application_fee_refund_id,reverse_transfer,refund_application_fee,transfer_reversal_amount_minor,application_fee_refund_amount_minor,policy_verified,policy_failure_code,stripe_event_id",
    ).in("order_id", orderIds);
  if (
    itemResult.error !== null || ticketResult.error !== null ||
    refundResult.error !== null
  ) {
    throw new Error("DATABASE");
  }
  const items = itemResult.data;
  const tickets = ticketResult.data;
  const refunds = refundResult.data;
  const { data: tiers, error: tierError } = await client.from("ticket_tiers")
    .select("id,quantity_total,sort_order").eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (tierError !== null) throw new Error("DATABASE");
  const tierLabels = new Map<string, "ga" | "vip">();
  for (const tier of tiers) {
    const label = tier.sort_order === 1
      ? "ga"
      : tier.sort_order === 2
      ? "vip"
      : null;
    if (label === null || tierLabels.has(tier.id)) throw new Error("DATABASE");
    tierLabels.set(tier.id, label);
  }
  const inventory = tiers.map((tier) => {
    const reservedQuantity = items.reduce((sum, item) => {
      const order = orders.find((candidate) => candidate.id === item.order_id);
      const reserved = order !== undefined && (
        order.status === "paid" || order.status === "payment_processing" ||
        (order.status === "creating_checkout" ||
          order.status === "checkout_open")
      );
      return sum +
        (item.ticket_tier_id === tier.id && reserved ? item.quantity : 0);
    }, 0);
    return {
      tier_label: tierLabels.get(tier.id),
      quantity_total: tier.quantity_total,
      reserved_quantity: reservedQuantity,
      available_quantity: tier.quantity_total - reservedQuantity,
    };
  });
  const objectIds = [
    ...orders.flatMap((order) => [
      order.stripe_checkout_session_id,
      order.stripe_payment_intent_id,
      order.stripe_charge_id,
    ]),
    ...refunds.map((refund) => refund.stripe_refund_id),
  ].filter((value): value is string => typeof value === "string");
  const { data: receipts, error: receiptError } = objectIds.length === 0
    ? { data: [], error: null }
    : await client.from("stripe_webhook_events").select(
      "stripe_event_id,event_type,stripe_object_id,processing_status,delivery_attempt_count,error_code",
    ).in("stripe_object_id", objectIds);
  if (receiptError !== null) throw new Error("DATABASE");
  const safeItems = items.map((item) => ({
    order_handle: handlesByOrderId.get(item.order_id),
    tier_label: tierLabels.get(item.ticket_tier_id),
    tier_name: item.tier_name,
    unit_amount_minor: item.unit_amount_minor,
    quantity: item.quantity,
    subtotal_minor: item.subtotal_minor,
    currency: item.currency,
  }));
  if (
    safeItems.some((item) =>
      item.order_handle === undefined || item.tier_label === undefined
    )
  ) throw new Error("DATABASE");
  const ticketSets = orders.map((order) => {
    const orderItems = items.filter((item) => item.order_id === order.id);
    const orderTickets = tickets.filter((ticket) =>
      ticket.order_id === order.id
    );
    const bindingsValid = orderTickets.length === 0 ||
      orderItems.every((item) => {
        const bound = orderTickets.filter((ticket) =>
          ticket.order_item_id === item.id &&
          ticket.ticket_tier_id === item.ticket_tier_id
        );
        return bound.length === item.quantity;
      });
    const sequencesValid = orderTickets.length === 0 ||
      orderItems.every((item) => {
        const sequences = orderTickets.filter((ticket) =>
          ticket.order_item_id === item.id
        )
          .map((ticket) => ticket.unit_sequence).sort((left, right) =>
            left - right
          );
        return sequences.length === item.quantity &&
          sequences.every((sequence, index) => sequence === index + 1);
      });
    return {
      order_handle: handlesByOrderId.get(order.id),
      ticket_count: orderTickets.length,
      unique_ticket_count: new Set(orderTickets.map((ticket) =>
        ticket.id
      )).size,
      valid_count:
        orderTickets.filter((ticket) => ticket.status === "valid").length,
      refunded_count:
        orderTickets.filter((ticket) => ticket.status === "refunded").length,
      bindings_valid: bindingsValid,
      sequences_valid: sequencesValid,
      refunded_timestamps_valid: orderTickets.every((ticket) =>
        ticket.status !== "refunded" || ticket.refunded_at !== null
      ),
    };
  });
  return {
    ok: true,
    orders: orders.map((order) => ({
      order_handle: handlesByOrderId.get(order.id),
      status: order.status,
      failure_code: order.failure_code,
      reconciliation_status: order.reconciliation_status,
      subtotal_minor: order.subtotal_minor,
      total_minor: order.total_minor,
      application_fee_amount_minor: order.application_fee_amount_minor,
      expected_organizer_proceeds_minor:
        order.expected_organizer_proceeds_minor,
    })),
    items: safeItems,
    tickets: ticketSets,
    refunds: refunds.map((refund) => ({
      order_handle: handlesByOrderId.get(refund.order_id),
      status: refund.status,
      amount_minor: refund.amount_minor,
      reverse_transfer: refund.reverse_transfer,
      refund_application_fee: refund.refund_application_fee,
      transfer_reversal_amount_minor: refund.transfer_reversal_amount_minor,
      application_fee_refund_amount_minor:
        refund.application_fee_refund_amount_minor,
      policy_verified: refund.policy_verified,
      policy_failure_code: refund.policy_failure_code,
    })),
    receipts: receipts.map((value) => ({
      event_type: value.event_type,
      processing_status: value.processing_status,
      delivery_attempt_count: value.delivery_attempt_count,
      error_code: value.error_code,
    })),
    inventory,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTestMode(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || value.livemode !== false) {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
}

function stripeId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    throw new Error("INPUT");
  }
  return value;
}

async function checkoutStatus(
  orderHandleValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await proofOrder(orderHandleValue);
  const session = await getStripe().checkout.sessions.retrieve(
    stripeId(order.stripe_checkout_session_id, "cs_test_"),
    {
      expand: [
        "line_items.data.price.product",
        "payment_intent.latest_charge",
      ],
    },
  );
  assertTestMode(session);
  const orderId = session.client_reference_id;
  if (typeof orderId !== "string" || !uuidPattern.test(orderId)) {
    throw new Error("STRIPE");
  }
  const { data: orderItems, error } = await getServiceClient().from(
    "order_items",
  ).select(
    "id,tier_name,unit_amount_minor,quantity,subtotal_minor,currency",
  ).eq("order_id", orderId);
  if (error !== null || orderItems.length === 0) throw new Error("DATABASE");
  const expectedById = new Map(orderItems.map((item) => [item.id, item]));
  const lineItems = session.line_items as unknown;
  if (
    !isRecord(lineItems) || lineItems.has_more !== false ||
    !Array.isArray(lineItems.data) ||
    lineItems.data.length !== expectedById.size
  ) throw new Error("STRIPE");
  const seen = new Set<string>();
  const lines: Array<Record<string, unknown>> = [];
  for (const line of lineItems.data) {
    if (!isRecord(line) || !isRecord(line.price)) throw new Error("STRIPE");
    assertTestMode(line.price);
    const product = line.price.product;
    assertTestMode(product);
    if (!isRecord(product.metadata)) throw new Error("STRIPE");
    const metadataKeys = Object.keys(product.metadata);
    const orderItemId = product.metadata.whereto_order_item_id;
    const expected = typeof orderItemId === "string"
      ? expectedById.get(orderItemId)
      : undefined;
    if (
      metadataKeys.length !== 1 ||
      metadataKeys[0] !== "whereto_order_item_id" ||
      typeof orderItemId !== "string" || !uuidPattern.test(orderItemId) ||
      expected === undefined || seen.has(orderItemId) ||
      line.quantity !== expected.quantity ||
      line.amount_subtotal !== expected.subtotal_minor ||
      line.amount_total !== expected.subtotal_minor ||
      line.currency !== expected.currency ||
      line.description !== expected.tier_name ||
      line.price.unit_amount !== expected.unit_amount_minor ||
      line.price.currency !== expected.currency ||
      line.price.type !== "one_time" ||
      product.name !== expected.tier_name
    ) throw new Error("STRIPE");
    seen.add(orderItemId);
    lines.push({
      tier_name: expected.tier_name,
      unit_amount_minor: expected.unit_amount_minor,
      quantity: expected.quantity,
      subtotal_minor: expected.subtotal_minor,
      currency: expected.currency,
      binding: "order_item",
    });
  }
  if (seen.size !== expectedById.size) throw new Error("STRIPE");
  lines.sort((left, right) =>
    Number(left.unit_amount_minor) - Number(right.unit_amount_minor)
  );
  const intent = typeof session.payment_intent === "object"
    ? session.payment_intent
    : null;
  if (intent !== null) assertTestMode(intent);
  const charge = intent !== null && typeof intent.latest_charge === "object"
    ? intent.latest_charge
    : null;
  if (charge !== null) assertTestMode(charge);
  return {
    ok: true,
    livemode: session.livemode,
    status: session.status,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    application_fee_amount: intent?.application_fee_amount ?? null,
    charge_paid: charge?.paid ?? null,
    line_bindings_valid: true,
    line_count: lines.length,
    admission_count: lines.reduce(
      (sum, line) => sum + Number(line.quantity),
      0,
    ),
    lines,
  };
}

async function deliver(value: unknown): Promise<Record<string, unknown>> {
  const event = await eventDescriptor(value);
  const response = await fetch(await signedRequest(event));
  return { status: response.status, receipt: await receipt(event.event_id) };
}

async function deliverTransientRetry(
  value: unknown,
): Promise<Record<string, unknown>> {
  const event = await eventDescriptor(value);
  if (event.type !== "checkout.session.expired") throw new Error("INPUT");
  const dependencies = createDefaultStripeWebhookDependencies();
  const first = await createStripeWebhookHandler({
    ...dependencies,
    retrieveSession: async () => {
      throw new Error("TASK17_FORCED_TRANSIENT");
    },
  })(await signedRequest(event));
  const second = await createStripeWebhookHandler(
    createDefaultStripeWebhookDependencies(),
  )(await signedRequest(event));
  return {
    statuses: [first.status, second.status],
    receipt: await receipt(event.event_id),
  };
}

async function expireCheckout(
  orderHandleValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await proofOrder(orderHandleValue);
  const session = await getStripe().checkout.sessions.expire(
    stripeId(order.stripe_checkout_session_id, "cs_test_"),
  );
  assertTestMode(session);
  if (session.status !== "expired") {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
  return { ok: true, livemode: session.livemode, status: session.status };
}

async function invalidSignature(): Promise<Record<string, unknown>> {
  const client = getServiceClient();
  const before = await client.from("stripe_webhook_events").select(
    "stripe_event_id",
    {
      count: "exact",
      head: true,
    },
  );
  const response = await fetch(
    `${getSupabaseServiceConfig().url}/functions/v1/stripe-webhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=invalid",
      },
      body: JSON.stringify({ id: "evt_task17invalid", object: "event" }),
    },
  );
  const after = await client.from("stripe_webhook_events").select(
    "stripe_event_id",
    {
      count: "exact",
      head: true,
    },
  );
  if (before.error !== null || after.error !== null) {
    throw new Error("DATABASE");
  }
  return {
    ok: response.status === 400 && before.count === after.count,
    status: response.status,
    receipt_delta: (after.count ?? 0) - (before.count ?? 0),
  };
}

async function proofOrder(orderHandleValue: unknown) {
  const handle = orderHandle(orderHandleValue);
  const { data, error } = await getServiceClient().from("orders").select(
    "id,status,total_minor,application_fee_amount_minor,expected_organizer_proceeds_minor,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_transfer_id,stripe_application_fee_id,stripe_balance_transaction_id",
  ).eq("buyer_email", fixtureBuyerEmail(handle)).single();
  if (error !== null) throw new Error("DATABASE");
  return data;
}

async function reconcilePayment(
  orderHandleValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await proofOrder(orderHandleValue);
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(
    stripeId(order.stripe_payment_intent_id, "pi_"),
  );
  const charge = await stripe.charges.retrieve(
    stripeId(order.stripe_charge_id, "ch_"),
  );
  const transfer = await stripe.transfers.retrieve(
    stripeId(order.stripe_transfer_id, "tr_"),
  );
  const fee = await stripe.applicationFees.retrieve(
    stripeId(order.stripe_application_fee_id, "fee_"),
  );
  const balance = await stripe.balanceTransactions.retrieve(
    stripeId(order.stripe_balance_transaction_id, "txn_"),
  );
  assertTestMode(intent);
  assertTestMode(charge);
  assertTestMode(transfer);
  assertTestMode(fee);
  const destination = typeof transfer.destination === "string"
    ? transfer.destination
    : transfer.destination?.id;
  if (destination === undefined) throw new Error("STRIPE");
  const lineStatus = await checkoutStatus(orderHandleValue);
  const connectedAccountMatches = destination === connectedAccountId() &&
    intent.transfer_data?.destination === connectedAccountId() &&
    charge.transfer_data?.destination === connectedAccountId();
  const persistedIdsMatch = intent.id === order.stripe_payment_intent_id &&
    charge.id === order.stripe_charge_id &&
    transfer.id === order.stripe_transfer_id &&
    fee.id === order.stripe_application_fee_id &&
    balance.id === order.stripe_balance_transaction_id;
  const crossObjectRelationsMatch = destinationChargeRelationsMatch({
    paymentIntentId: intent.id,
    chargeId: charge.id,
    transferId: transfer.id,
    connectedAccountId: connectedAccountId(),
    charge: charge as unknown as Record<string, unknown>,
    transfer: transfer as unknown as Record<string, unknown>,
    applicationFee: fee as unknown as Record<string, unknown>,
  });
  return {
    ok: intent.amount === order.total_minor &&
      charge.amount === order.total_minor &&
      transfer.amount === order.total_minor &&
      fee.amount === order.application_fee_amount_minor &&
      transfer.amount - fee.amount ===
        order.expected_organizer_proceeds_minor &&
      connectedAccountMatches && persistedIdsMatch &&
      crossObjectRelationsMatch &&
      lineStatus.line_bindings_valid === true,
    livemode: false,
    connected_account_matches: connectedAccountMatches,
    persisted_ids_match: persistedIdsMatch,
    cross_object_relations_match: crossObjectRelationsMatch,
    destination_charge: connectedAccountMatches,
    line_bindings_valid: lineStatus.line_bindings_valid,
    line_count: lineStatus.line_count,
    admission_count: lineStatus.admission_count,
    total_minor: order.total_minor,
    application_fee_actual: fee.amount,
    transfer_less_application_fee: transfer.amount - fee.amount,
    balance_transaction_amount: balance.amount,
  };
}

async function reconcileEvents(
  orderHandleValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await proofOrder(orderHandleValue);
  const events = await getStripe().events.list({ limit: 100 });
  const matching = new Set<string>();
  for (const event of events.data) {
    const object = event.data.object as unknown as Record<string, unknown>;
    if (
      object.id === order.stripe_payment_intent_id ||
      object.id === order.stripe_charge_id ||
      object.object === "checkout.session" &&
        (object.payment_intent === order.stripe_payment_intent_id ||
          (object.payment_intent as { id?: string } | undefined)?.id ===
            order.stripe_payment_intent_id) ||
      object.object === "refund" &&
        object.payment_intent === order.stripe_payment_intent_id
    ) matching.add(event.type);
  }
  return {
    ok: events.has_more === false &&
      events.data.every((event) => event.livemode === false) &&
      matching.has("checkout.session.completed") &&
      [...matching].some((type) => type.startsWith("refund.")),
    livemode: events.data.some((event) => event.livemode !== false),
    matching_types: [...matching].sort(),
    has_more: events.has_more,
  };
}

async function createRefund(
  orderHandleValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await proofOrder(orderHandleValue);
  const stripeClient = getStripe();
  let prepared: {
    totalMinor: number;
    applicationFeeAmountMinor: number;
  } | undefined;
  let evidence: {
    transferReversalAmountMinor: number;
    applicationFeeRefundAmountMinor: number;
  } | undefined;
  const result = await createWholeOrderRefund(
    order.id,
    "requested_by_customer",
    {
      prepareWholeOrderRefund: async (orderId, reason) => {
        const { data, error } = await getServiceClient().rpc(
          "server_prepare_whole_order_refund",
          { p_order_id: orderId, p_reason: reason },
        );
        if (error !== null || !Array.isArray(data) || data.length !== 1) {
          throw new Error("DATABASE");
        }
        const row = data[0];
        prepared = {
          totalMinor: row.total_minor,
          applicationFeeAmountMinor: row.application_fee_amount_minor,
        };
        return {
          orderId: row.order_id,
          paymentIntentId: row.payment_intent_id,
          chargeId: row.charge_id,
          transferId: row.transfer_id,
          applicationFeeId: row.application_fee_id,
          currency: row.currency,
          totalMinor: row.total_minor,
          applicationFeeAmountMinor: row.application_fee_amount_minor,
          reason: row.reason,
        };
      },
      createRefund: async (params, options) => {
        const created = await stripeClient.refunds.create(
          params as Stripe.RefundCreateParams,
          options,
        );
        assertTestMode(created);
        return created;
      },
      retrieveRefundEvidence: async (refundId, snapshot) => {
        const transfer = await stripeClient.transfers.retrieve(
          snapshot.transferId,
          { expand: ["reversals"] },
        );
        assertTestMode(transfer);
        const reversal = transfer.reversals?.data.find((value) => {
          const source = typeof value.source_refund === "string"
            ? value.source_refund
            : value.source_refund?.id;
          return source === refundId;
        });
        const applicationFee = await stripeClient.applicationFees.retrieve(
          snapshot.applicationFeeId,
        );
        assertTestMode(applicationFee);
        const feeRefunds = await stripeClient.applicationFees.listRefunds(
          snapshot.applicationFeeId,
          { limit: 10 },
        );
        const feeRefund = feeRefunds.data.length === 1
          ? feeRefunds.data[0]
          : undefined;
        if (
          reversal === undefined || reversal.object !== "transfer_reversal" ||
          feeRefund === undefined || feeRefund.object !== "fee_refund" ||
          feeRefund.currency !== snapshot.currency ||
          (typeof feeRefund.fee === "string"
              ? feeRefund.fee
              : feeRefund.fee.id) !== snapshot.applicationFeeId
        ) throw new Error("STRIPE");
        evidence = {
          transferReversalAmountMinor: reversal.amount,
          applicationFeeRefundAmountMinor: feeRefund.amount,
        };
        return {
          transferReversalId: reversal.id,
          transferReversalAmountMinor: reversal.amount,
          applicationFeeRefundId: feeRefund.id,
          applicationFeeRefundAmountMinor: feeRefund.amount,
        };
      },
      updateRefundMetadata: async (refundId, metadata) => {
        const updated = await stripeClient.refunds.update(refundId, {
          metadata,
        });
        assertTestMode(updated);
      },
    },
  );
  if (prepared === undefined || evidence === undefined) {
    throw new Error("STRIPE");
  }
  return {
    ok: true,
    livemode: false,
    status: result.status,
    amount: prepared.totalMinor,
    reverse_transfer: true,
    refund_application_fee: true,
    reversal_amount: evidence.transferReversalAmountMinor,
    application_fee_refund_amount: evidence.applicationFeeRefundAmountMinor,
    expected_application_fee_amount: prepared.applicationFeeAmountMinor,
  };
}

async function cleanup(
  closeConnectedAccount: unknown,
): Promise<Record<string, unknown>> {
  if (typeof closeConnectedAccount !== "boolean") throw new Error("INPUT");
  const client = getServiceClient();
  const organizer = await fixtureOrganizer();
  const authUser = await fixtureAuthUser(organizer?.id);
  const eventIds: string[] = [];
  const orderIds: string[] = [];
  const objectIds: string[] = [];
  const receiptIds = new Set<string>();
  const priceIds = new Set<string>();
  const productIds = new Set<string>();
  let deletedItemCount = 0;
  let deletedTicketCount = 0;
  let deletedRefundCount = 0;
  let deletedTierCount = 0;
  if (organizer !== null) {
    const { data: events, error: eventReadError } = await client.from("events")
      .select("id")
      .eq("organizer_id", organizer.id);
    if (eventReadError !== null) throw new Error("DATABASE");
    eventIds.push(...(events ?? []).map((event) => event.id));
    if (eventIds.length > 0) {
      const { data: tierRows, error: tierReadError } = await client.from(
        "ticket_tiers",
      ).select("id").in("event_id", eventIds);
      if (tierReadError !== null) throw new Error("DATABASE");
      deletedTierCount = tierRows.length;
      const { data: orders, error: orderReadError } = await client.from(
        "orders",
      ).select(
        "id,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,last_stripe_event_id",
      ).in("event_id", eventIds);
      if (orderReadError !== null) throw new Error("DATABASE");
      for (const order of orders ?? []) {
        orderIds.push(order.id);
        if (order.last_stripe_event_id) {
          receiptIds.add(order.last_stripe_event_id);
        }
        for (
          const value of [
            order.stripe_checkout_session_id,
            order.stripe_payment_intent_id,
            order.stripe_charge_id,
          ]
        ) if (value) objectIds.push(value);
        if (order.stripe_checkout_session_id) {
          const session = await getStripe().checkout.sessions.retrieve(
            stripeId(order.stripe_checkout_session_id, "cs_test_"),
            { expand: ["line_items.data.price.product"] },
          );
          assertTestMode(session);
          if (session.status === "open") {
            const expired = await getStripe().checkout.sessions.expire(
              session.id,
            );
            assertTestMode(expired);
            if (expired.status !== "expired") throw new Error("STRIPE");
          }
          const lineItems = session.line_items as unknown;
          if (
            !isRecord(lineItems) || lineItems.has_more !== false ||
            !Array.isArray(lineItems.data)
          ) throw new Error("STRIPE");
          for (const line of lineItems.data) {
            if (!isRecord(line) || !isRecord(line.price)) {
              throw new Error("STRIPE");
            }
            assertTestMode(line.price);
            const product = line.price.product;
            assertTestMode(product);
            if (
              typeof line.price.id !== "string" ||
              !line.price.id.startsWith("price_") ||
              typeof product.id !== "string" || !product.id.startsWith("prod_")
            ) throw new Error("STRIPE");
            priceIds.add(line.price.id);
            productIds.add(product.id);
          }
        }
      }
    }
    if (orderIds.length > 0) {
      const { data: refunds, error: refundReadError } = await client.from(
        "refunds",
      ).select(
        "stripe_refund_id,stripe_event_id",
      ).in("order_id", orderIds);
      if (refundReadError !== null) throw new Error("DATABASE");
      deletedRefundCount = (refunds ?? []).length;
      for (const refund of refunds ?? []) {
        objectIds.push(refund.stripe_refund_id);
        if (refund.stripe_event_id) receiptIds.add(refund.stripe_event_id);
      }
      const [trackedItems, trackedTickets] = await Promise.all([
        client.from("order_items").select("id").in("order_id", orderIds),
        client.from("tickets").select("id").in("order_id", orderIds),
      ]);
      if (trackedItems.error !== null || trackedTickets.error !== null) {
        throw new Error("DATABASE");
      }
      deletedItemCount = trackedItems.data.length;
      deletedTicketCount = trackedTickets.data.length;
    }
    if (objectIds.length > 0) {
      const { data: receipts, error: receiptReadError } = await client.from(
        "stripe_webhook_events",
      ).select(
        "stripe_event_id",
      ).in("stripe_object_id", objectIds);
      if (receiptReadError !== null) throw new Error("DATABASE");
      for (const value of receipts ?? []) receiptIds.add(value.stripe_event_id);
    }
    for (const priceId of priceIds) {
      const price = await getStripe().prices.update(priceId, { active: false });
      assertTestMode(price);
      if (price.active !== false) throw new Error("STRIPE");
    }
    for (const productId of productIds) {
      const product = await getStripe().products.update(productId, {
        active: false,
      });
      assertTestMode(product);
      if (product.active !== false) throw new Error("STRIPE");
    }
    const ensureDelete = (error: unknown, stage: string) => {
      if (error !== null) throw new Error(`DATABASE_DELETE_${stage}`);
    };
    if (orderIds.length > 0) {
      ensureDelete(
        (await client.from("tickets").delete().in("order_id", orderIds)).error,
        "TICKETS",
      );
      // The Task 17 fixture never creates a dispute. That table intentionally
      // denies the service_role direct access; the restrictive order foreign
      // key makes the successful order delete the exact zero-dispute proof.
      ensureDelete(
        (await client.from("refunds").delete().in("order_id", orderIds)).error,
        "REFUNDS",
      );
      ensureDelete(
        (await client.from("order_items").delete().in("order_id", orderIds))
          .error,
        "ORDER_ITEMS",
      );
      ensureDelete(
        (await client.from("orders").delete().in("id", orderIds)).error,
        "ORDERS",
      );
    }
    if (eventIds.length > 0) {
      ensureDelete(
        (await client.from("ticket_tiers").delete().in("event_id", eventIds))
          .error,
        "TIERS",
      );
      ensureDelete(
        (await client.from("events").delete().in("id", eventIds)).error,
        "EVENTS",
      );
    }
    if (receiptIds.size > 0) {
      ensureDelete(
        (await client.from("stripe_webhook_events").delete()
          .in("stripe_event_id", [...receiptIds])).error,
        "RECEIPTS",
      );
    }
    ensureDelete(
      (await client.from("organizer_stripe_accounts").delete()
        .eq("organizer_id", organizer.id)).error,
      "CONNECT",
    );
    ensureDelete(
      (await client.from("organizers").delete().eq("id", organizer.id)).error,
      "ORGANIZER",
    );
  }
  if (authUser !== null) {
    await deleteAndVerifyFixtureAuthUser(
      authUser,
      async (id) => {
        const result = await client.auth.admin.deleteUser(id);
        if (result.error !== null) throw new Error("DATABASE_DELETE_AUTH");
      },
      loadFixtureAuthUserById,
      loadFixtureAuthPage,
    );
  }
  if (await fixtureAuthUser() !== null) throw new Error("DATABASE_DELETE_AUTH");
  const count = async (table: string, column: string, value: string) => {
    const result = await client.from(table).select(column, {
      count: "exact",
      head: true,
    })
      .eq(column, value);
    if (result.error !== null) throw new Error("DATABASE");
    return result.count ?? 0;
  };
  const eventCount = organizer === null
    ? 0
    : await count("events", "organizer_id", organizer.id);
  const organizerCount = organizer === null
    ? 0
    : await count("organizers", "id", organizer.id);
  const connectCount = organizer === null
    ? 0
    : await count("organizer_stripe_accounts", "organizer_id", organizer.id);
  const orderCount = eventIds.length === 0
    ? 0
    : (await Promise.all(eventIds.map((id) => count("orders", "event_id", id))))
      .reduce((sum, value) => sum + value, 0);
  const tierCount = eventIds.length === 0 ? 0 : (await Promise.all(
    eventIds.map((id) => count("ticket_tiers", "event_id", id)),
  ))
    .reduce((sum, value) => sum + value, 0);
  const receiptCount = receiptIds.size === 0 ? 0 : await (async () => {
    const result = await client.from("stripe_webhook_events").select(
      "stripe_event_id",
      {
        count: "exact",
        head: true,
      },
    ).in("stripe_event_id", [...receiptIds]);
    if (result.error !== null) throw new Error("DATABASE");
    return result.count ?? 0;
  })();
  const childCount = async (
    table: "tickets" | "refunds" | "order_items",
  ) => {
    if (orderIds.length === 0) return 0;
    const result = await client.from(table).select("id", {
      count: "exact",
      head: true,
    })
      .in("order_id", orderIds);
    if (result.error !== null) throw new Error("DATABASE");
    return result.count ?? 0;
  };
  const [ticketCount, refundCount, itemCount] = await Promise.all(
    [
      childCount("tickets"),
      childCount("refunds"),
      childCount("order_items"),
    ],
  );
  const disputeCount = 0; // A dispute row would have blocked the order delete.
  if (closeConnectedAccount) mustCloseConnectedAccount();
  const accountLifecycle = await applyDiagnosticAccountCleanup(
    closeConnectedAccount,
    () =>
      getStripe().v2.core.accounts.retrieve(connectedAccountId(), {
        include: ACCOUNT_INCLUDE,
      }),
    (connectedAccount) =>
      getStripe().v2.core.accounts.close(connectedAccount.id, {
        applied_configurations: connectedAccount.applied_configurations,
      }),
    (connectedAccount) => {
      if (connectedAccount.livemode !== false) {
        throw new Error("LIVE_MODE_FORBIDDEN");
      }
    },
  );
  const accountLifecycleVerified = closeConnectedAccount
    ? accountLifecycle.connectedAccountClosed
    : accountLifecycle.connectedAccountPreserved;
  return {
    ok: accountLifecycleVerified && [
      eventCount,
      organizerCount,
      connectCount,
      orderCount,
      tierCount,
      receiptCount,
      ticketCount,
      disputeCount,
      refundCount,
      itemCount,
    ]
      .every((value) => value === 0),
    event_count: eventCount,
    organizer_count: organizerCount,
    connect_count: connectCount,
    order_count: orderCount,
    tier_count: tierCount,
    receipt_count: receiptCount,
    ticket_count: ticketCount,
    dispute_count: disputeCount,
    refund_count: refundCount,
    item_count: itemCount,
    deleted_order_count: orderIds.length,
    deleted_tier_count: deletedTierCount,
    deleted_receipt_count: receiptIds.size,
    deleted_ticket_count: deletedTicketCount,
    deleted_refund_count: deletedRefundCount,
    deleted_item_count: deletedItemCount,
    archived_price_count: priceIds.size,
    archived_product_count: productIds.size,
    auth_user_absent: true,
    connected_account_closed: accountLifecycle.connectedAccountClosed,
    connected_account_preserved: accountLifecycle.connectedAccountPreserved,
  };
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") return json({ ok: false }, 405);
    if (!authorized(request)) return json({ ok: false }, 401);
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ ok: false }, 400);
    }
    const action = (body as Record<string, unknown>).action;
    if (typeof action !== "string" || !actions.has(action)) {
      return json({ ok: false }, 400);
    }
    const input = body as Record<string, unknown>;
    if (action === "account_diagnostic") return json(await serverProof());
    if (action === "server_proof") return json(await serverProof());
    if (action === "setup") return json(await setup());
    if (action === "inspect") return json(await inspect(input.event_id));
    if (action === "checkout_status") {
      return json(await checkoutStatus(input.order_handle));
    }
    if (action === "deliver") return json(await deliver(input.event));
    if (action === "deliver_transient_retry") {
      return json(await deliverTransientRetry(input.event));
    }
    if (action === "expire_checkout") {
      return json(await expireCheckout(input.order_handle));
    }
    if (action === "invalid_signature") return json(await invalidSignature());
    if (action === "reconcile_payment") {
      return json(await reconcilePayment(input.order_handle));
    }
    if (action === "reconcile_events") {
      return json(await reconcileEvents(input.order_handle));
    }
    if (action === "create_refund") {
      return json(await createRefund(input.order_handle));
    }
    if (action === "cleanup") {
      return json(await cleanup(input.close_connected_account));
    }
    return json({ ok: false }, 400);
  } catch (error) {
    const kind = error instanceof Error && ([
        "CONFIG",
        "DATABASE",
        "INPUT",
        "LIVE_MODE_FORBIDDEN",
        "STRIPE",
      ].includes(error.message) ||
        /^DATABASE_DELETE_[A-Z_]+$/.test(error.message))
      ? error.message
      : "UNKNOWN";
    return json({ ok: false, kind }, 500);
  }
});
