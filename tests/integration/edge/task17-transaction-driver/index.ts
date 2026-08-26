// This exact source is materialized under supabase/functions only for the
// duration of run-stripe-ticketing-proof.sh, then the function and secrets are
// deleted by its EXIT trap. Imports intentionally resolve from that location.
import { getServiceClient } from "../_shared/database.ts";
import {
  getStripeWebhookSecret,
  getSupabaseServiceConfig,
} from "../_shared/env.ts";
import { getStripe } from "../_shared/stripeClient.ts";
import {
  ACCOUNT_INCLUDE,
  toSafeConnectStatus,
  validateApprovedConnectAccount,
} from "../stripe-connect-session/connect.ts";
import {
  createDefaultStripeWebhookDependencies,
  createStripeWebhookHandler,
} from "../stripe-webhook/index.ts";

const actions = new Set([
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

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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

function eventDescriptor(value: unknown): EventDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INPUT");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "created,event_id,object,object_id,type") {
    throw new Error("INPUT");
  }
  if (
    typeof row.event_id !== "string" ||
    !/^evt_task17[a-z0-9]+$/.test(row.event_id) ||
    !Number.isSafeInteger(row.created) ||
    Math.abs(Math.floor(Date.now() / 1_000) - (row.created as number)) > 300
  ) throw new Error("INPUT");
  const valid = (
    row.type === "checkout.session.completed" &&
    row.object === "checkout.session" &&
    typeof row.object_id === "string" &&
    /^cs_test_[A-Za-z0-9]+$/.test(row.object_id)
  ) || (
    row.type === "checkout.session.expired" &&
    row.object === "checkout.session" &&
    typeof row.object_id === "string" &&
    /^cs_test_[A-Za-z0-9]+$/.test(row.object_id)
  ) || (
    row.type === "refund.updated" && row.object === "refund" &&
    typeof row.object_id === "string" && /^re_[A-Za-z0-9]+$/.test(row.object_id)
  );
  if (!valid) throw new Error("INPUT");
  return row as EventDescriptor;
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
  return data;
}

async function serverProof(): Promise<Record<string, unknown>> {
  mustCloseConnectedAccount();
  const stripe = getStripe();
  const accountId = connectedAccountId();
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ACCOUNT_INCLUDE,
  });
  if (account.livemode !== false || account.id !== accountId) {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
  const projection = validateApprovedConnectAccount(account);
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

async function fixtureAuthUser(): Promise<{ id: string } | null> {
  const result = await getServiceClient().auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (result.error !== null) throw new Error("DATABASE");
  const email = `${fixturePrefix()}@example.invalid`;
  const user = result.data.users.find((candidate) => candidate.email === email);
  return user === undefined ? null : { id: user.id };
}

async function setup(): Promise<Record<string, unknown>> {
  await serverProof();
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
  const tierRead = await client.from("ticket_tiers")
    .select("id")
    .eq("event_id", event.id).eq("sort_order", 1).maybeSingle();
  if (tierRead.error !== null) throw new Error("DATABASE");
  let tier = tierRead.data;
  if (tier === null) {
    const tierId = crypto.randomUUID();
    const { error } = await client.from("ticket_tiers").insert({
      id: tierId,
      event_id: event.id,
      name: "Task 17 General Admission",
      unit_amount_minor: 3001,
      currency: "usd",
      quantity_total: 10,
      status: "active",
      sort_order: 1,
    });
    if (error !== null) throw new Error("DATABASE");
    tier = { id: tierId };
  }
  return {
    ok: true,
    event_id: event.id,
    tier_id: tier.id,
    subtotal_minor: 3001,
    application_fee_minor: 200,
  };
}

async function inspect(eventId: unknown): Promise<Record<string, unknown>> {
  if (typeof eventId !== "string" || !uuidPattern.test(eventId)) {
    throw new Error("INPUT");
  }
  const client = getServiceClient();
  const { data: orders, error: orderError } = await client.from("orders")
    .select(
      "id,buyer_email,status,failure_code,reconciliation_status,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id,stripe_transfer_id,stripe_application_fee_id,stripe_balance_transaction_id,last_stripe_event_id,subtotal_minor,total_minor,application_fee_amount_minor,expected_organizer_proceeds_minor",
    ).eq("event_id", eventId).order("created_at", { ascending: true });
  if (orderError !== null) throw new Error("DATABASE");
  const orderIds = orders.map((order) => order.id);
  const itemResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("order_items").select(
      "id,order_id,ticket_tier_id,quantity",
    )
      .in("order_id", orderIds);
  const ticketResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("tickets").select("id,order_id,status,refunded_at").in(
      "order_id",
      orderIds,
    );
  const refundResult = orderIds.length === 0
    ? { data: [], error: null }
    : await client.from("refunds").select(
      "id,order_id,stripe_refund_id,status,amount_minor,stripe_transfer_reversal_id,stripe_application_fee_refund_id,reverse_transfer,refund_application_fee,stripe_event_id",
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
    .select("id,quantity_total").eq("event_id", eventId);
  if (tierError !== null) throw new Error("DATABASE");
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
      ticket_tier_id: tier.id,
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
  return { ok: true, orders, items, tickets, refunds, receipts, inventory };
}

function stripeId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    throw new Error("INPUT");
  }
  return value;
}

async function checkoutStatus(
  sessionIdValue: unknown,
): Promise<Record<string, unknown>> {
  const session = await getStripe().checkout.sessions.retrieve(
    stripeId(sessionIdValue, "cs_test_"),
    { expand: ["payment_intent.latest_charge"] },
  );
  if (session.livemode !== false) throw new Error("LIVE_MODE_FORBIDDEN");
  const intent = typeof session.payment_intent === "object"
    ? session.payment_intent
    : null;
  const charge = intent !== null && typeof intent.latest_charge === "object"
    ? intent.latest_charge
    : null;
  return {
    ok: true,
    livemode: session.livemode,
    status: session.status,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    application_fee_amount: intent?.application_fee_amount ?? null,
    charge_paid: charge?.paid ?? null,
  };
}

async function deliver(value: unknown): Promise<Record<string, unknown>> {
  const event = eventDescriptor(value);
  const response = await fetch(await signedRequest(event));
  return { status: response.status, receipt: await receipt(event.event_id) };
}

async function deliverTransientRetry(
  value: unknown,
): Promise<Record<string, unknown>> {
  const event = eventDescriptor(value);
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
  sessionIdValue: unknown,
): Promise<Record<string, unknown>> {
  const session = await getStripe().checkout.sessions.expire(
    stripeId(sessionIdValue, "cs_test_"),
  );
  if (session.livemode !== false || session.status !== "expired") {
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

async function paidOrder(orderIdValue: unknown) {
  if (typeof orderIdValue !== "string" || !uuidPattern.test(orderIdValue)) {
    throw new Error("INPUT");
  }
  const { data, error } = await getServiceClient().from("orders").select(
    "id,status,total_minor,application_fee_amount_minor,expected_organizer_proceeds_minor,stripe_payment_intent_id,stripe_charge_id,stripe_transfer_id,stripe_application_fee_id,stripe_balance_transaction_id",
  ).eq("id", orderIdValue).single();
  if (error !== null) throw new Error("DATABASE");
  return data;
}

async function reconcilePayment(
  orderIdValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await paidOrder(orderIdValue);
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
  if (
    [intent.livemode, charge.livemode, transfer.livemode, fee.livemode].some(
      Boolean,
    )
  ) {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
  const destination = typeof transfer.destination === "string"
    ? transfer.destination
    : transfer.destination?.id;
  if (destination === undefined) throw new Error("STRIPE");
  return {
    ok: intent.amount === order.total_minor &&
      charge.amount === order.total_minor &&
      transfer.amount === order.total_minor &&
      fee.amount === order.application_fee_amount_minor &&
      transfer.amount - fee.amount === order.expected_organizer_proceeds_minor,
    livemode: false,
    connected_account_matches: destination === connectedAccountId() &&
      intent.transfer_data?.destination === connectedAccountId(),
    persisted_ids_match: intent.id === order.stripe_payment_intent_id &&
      charge.id === order.stripe_charge_id &&
      transfer.id === order.stripe_transfer_id &&
      fee.id === order.stripe_application_fee_id &&
      balance.id === order.stripe_balance_transaction_id,
    total_minor: order.total_minor,
    application_fee_actual: fee.amount,
    transfer_less_application_fee: transfer.amount - fee.amount,
    balance_transaction_amount: balance.amount,
  };
}

async function reconcileEvents(
  orderIdValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await paidOrder(orderIdValue);
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
    ok: events.data.every((event) => event.livemode === false) &&
      matching.has("checkout.session.completed") &&
      [...matching].some((type) => type.startsWith("refund.")),
    livemode: events.data.some((event) => event.livemode),
    matching_types: [...matching].sort(),
  };
}

async function createRefund(
  orderIdValue: unknown,
): Promise<Record<string, unknown>> {
  const order = await paidOrder(orderIdValue);
  if (!["paid", "requires_review", "refunded"].includes(order.status)) {
    throw new Error("INPUT");
  }
  const stripe = getStripe();
  const intentId = stripeId(order.stripe_payment_intent_id, "pi_");
  const refund = await stripe.refunds.create({
    payment_intent: intentId,
    amount: order.total_minor,
    reverse_transfer: true,
    refund_application_fee: true,
    metadata: { order_id: order.id },
  }, { idempotencyKey: `${fixturePrefix()}-${order.id}` });
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.livemode !== false) throw new Error("LIVE_MODE_FORBIDDEN");
  const transfer = await stripe.transfers.retrieve(
    stripeId(order.stripe_transfer_id, "tr_"),
    { expand: ["reversals"] },
  );
  const reversal = transfer.reversals?.data.find((value) => {
    const source = typeof value.source_refund === "string"
      ? value.source_refund
      : value.source_refund?.id;
    return source === refund.id;
  }) ?? (transfer.reversals?.data.length === 1
    ? transfer.reversals.data[0]
    : undefined);
  const feeId = stripeId(order.stripe_application_fee_id, "fee_");
  const feeRefunds = await stripe.applicationFees.listRefunds(feeId, {
    limit: 10,
  });
  const feeRefund = feeRefunds.data.length === 1
    ? feeRefunds.data[0]
    : undefined;
  if (reversal === undefined || feeRefund === undefined) {
    throw new Error("STRIPE");
  }
  const updated = await stripe.refunds.update(refund.id, {
    metadata: {
      order_id: order.id,
      whereto_refund_policy: "destination_v1",
      whereto_reverse_transfer: "true",
      whereto_refund_application_fee: "true",
      whereto_transfer_reversal_amount: String(reversal.amount),
      whereto_application_fee_refund_id: feeRefund.id,
      whereto_application_fee_refund_amount: String(feeRefund.amount),
    },
  });
  return {
    ok: true,
    livemode: intent.livemode,
    refund_id: updated.id,
    amount: updated.amount,
    reversal_amount: reversal.amount,
    application_fee_refund_amount: feeRefund.amount,
  };
}

async function cleanup(): Promise<Record<string, unknown>> {
  mustCloseConnectedAccount();
  const client = getServiceClient();
  const organizer = await fixtureOrganizer();
  const authUser = await fixtureAuthUser();
  const eventIds: string[] = [];
  const orderIds: string[] = [];
  const objectIds: string[] = [];
  const receiptIds = new Set<string>();
  if (organizer !== null) {
    const { data: events, error: eventReadError } = await client.from("events")
      .select("id")
      .eq("organizer_id", organizer.id);
    if (eventReadError !== null) throw new Error("DATABASE");
    eventIds.push(...(events ?? []).map((event) => event.id));
    if (eventIds.length > 0) {
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
          try {
            const session = await getStripe().checkout.sessions.retrieve(
              order.stripe_checkout_session_id,
            );
            if (session.status === "open") {
              await getStripe().checkout.sessions.expire(session.id);
            }
          } catch {
            // Supabase cleanup must continue for immutable or already-terminal test objects.
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
      for (const refund of refunds ?? []) {
        objectIds.push(refund.stripe_refund_id);
        receiptIds.add(refund.stripe_event_id);
      }
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
    const result = await client.auth.admin.deleteUser(authUser.id);
    if (result.error !== null) throw new Error("DATABASE");
  }
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
  const stripe = getStripe();
  let connectedAccount = await stripe.v2.core.accounts.retrieve(
    connectedAccountId(),
    { include: ACCOUNT_INCLUDE },
  );
  if (connectedAccount.livemode !== false) {
    throw new Error("LIVE_MODE_FORBIDDEN");
  }
  if (connectedAccount.closed !== true) {
    connectedAccount = await stripe.v2.core.accounts.close(
      connectedAccount.id,
      { applied_configurations: connectedAccount.applied_configurations },
    );
  }
  const connectedAccountClosed = connectedAccount.closed === true &&
    connectedAccount.livemode === false;
  return {
    ok: connectedAccountClosed && [
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
    connected_account_closed: connectedAccountClosed,
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
    if (action === "server_proof") return json(await serverProof());
    if (action === "setup") return json(await setup());
    if (action === "inspect") return json(await inspect(input.event_id));
    if (action === "checkout_status") {
      return json(await checkoutStatus(input.session_id));
    }
    if (action === "deliver") return json(await deliver(input.event));
    if (action === "deliver_transient_retry") {
      return json(await deliverTransientRetry(input.event));
    }
    if (action === "expire_checkout") {
      return json(await expireCheckout(input.session_id));
    }
    if (action === "invalid_signature") return json(await invalidSignature());
    if (action === "reconcile_payment") {
      return json(await reconcilePayment(input.order_id));
    }
    if (action === "reconcile_events") {
      return json(await reconcileEvents(input.order_id));
    }
    if (action === "create_refund") {
      return json(await createRefund(input.order_id));
    }
    if (action === "cleanup") return json(await cleanup());
    return json({ ok: false }, 400);
  } catch (error) {
    const kind = error instanceof Error && ([
        "CONFIG",
        "DATABASE",
        "INPUT",
        "LIVE_MODE_FORBIDDEN",
        "STRIPE",
      ].includes(error.message) || /^DATABASE_DELETE_[A-Z_]+$/.test(error.message))
      ? error.message
      : "UNKNOWN";
    return json({ ok: false, kind }, 500);
  }
});
