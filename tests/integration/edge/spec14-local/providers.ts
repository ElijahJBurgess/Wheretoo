import {
  type AccountMode,
  type CheckoutCreateMode,
  type EmailMode,
  nextId,
  type ProviderState,
  type ProviderStore,
  type RefundMode,
} from "./state.ts";

export interface ProviderBoundaryConfig {
  gatewayOrigin: string;
  restOrigin: string;
  authOrigin: string;
  stripeWebhookSecret: string;
  resendEndpoint: string;
  moderationEndpoint?: string;
}

export interface CompletedCheckout {
  event: Record<string, unknown>;
  signature: string;
  paymentIntentId: string;
  chargeId: string;
  applicationFeeId: string;
  transferId: string;
}

export interface ProviderControl {
  snapshot(): Promise<ProviderState>;
  setAccountMode(mode: AccountMode): Promise<void>;
  setCheckoutCreateMode(mode: CheckoutCreateMode): Promise<void>;
  setRefundMode(mode: RefundMode, refundId?: string): Promise<void>;
  setEmailMode(mode: EmailMode): Promise<void>;
  setModerationMode(mode: "approve" | "review" | "failed"): Promise<void>;
  completeCheckout(sessionId: string): Promise<CompletedCheckout>;
  expireCheckout(sessionId: string): Promise<Record<string, unknown>>;
  createRefund(chargeId: string): Promise<Record<string, unknown>>;
  createStripeEvent(
    type: string,
    objectId: string,
  ): Promise<{ event: Record<string, unknown>; signature: string }>;
}

export interface ProviderBoundary {
  fetch: typeof fetch;
  control: ProviderControl;
}

type NativeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const stripeOrigin = "https://api.stripe.com";

export function createProviderBoundary(
  config: ProviderBoundaryConfig,
  store: ProviderStore,
  nativeFetch: NativeFetch,
): ProviderBoundary {
  const control: ProviderControl = {
    snapshot: () => store.read(),
    setAccountMode: (mode) =>
      store.update((state) => {
        state.stripe.accountMode = mode;
      }),
    setCheckoutCreateMode: (mode) =>
      store.update((state) => {
        state.stripe.checkoutCreateMode = mode;
      }),
    setRefundMode: (mode, refundId) =>
      store.update((state) => {
        state.stripe.refundMode = mode;
        if (refundId) applyRefundMode(state, refundId, mode);
      }),
    setEmailMode: (mode) =>
      store.update((state) => {
        state.email.mode = mode;
      }),
    setModerationMode: (mode) =>
      store.update((state) => {
        state.moderation.mode = mode;
      }),
    completeCheckout: (sessionId) => completeCheckout(store, config, sessionId),
    expireCheckout: (sessionId) =>
      store.update((state) => expireSession(state, sessionId)),
    createRefund: (chargeId) =>
      store.update((state) => refundForCharge(state, chargeId, undefined)),
    createStripeEvent: (type, objectId) =>
      store.update(async (state) => {
        const event = makeEvent(state, type, objectId);
        return {
          event,
          signature: await createStripeSignature(
            JSON.stringify(event),
            config.stripeWebhookSecret,
          ),
        };
      }),
  };

  const boundaryFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (
      [config.restOrigin, config.authOrigin, config.gatewayOrigin].includes(
        url.origin,
      )
    ) {
      return await nativeFetch(input, init);
    }
    if (url.origin === stripeOrigin) {
      return await stripeResponse(store, request);
    }
    if (request.url === config.resendEndpoint) {
      return await resendResponse(store, request);
    }
    if (
      config.moderationEndpoint && request.url === config.moderationEndpoint
    ) {
      return await moderationResponse(store, request);
    }
    throw new Error(`Outbound request denied: ${url.origin}`);
  };
  return { fetch: boundaryFetch as typeof fetch, control };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function unknownAfterCommit(
  response: Response,
  resource: "checkout" | "refund",
) {
  const headers = new Headers(response.headers);
  headers.set("x-spec14-unknown-after-commit", resource);
  return new Response(response.body, { status: response.status, headers });
}

function stripeUnavailable(message: string): Response {
  return json({
    error: { type: "api_error", code: "spec14_provider_failed", message },
  }, 503);
}

async function stripeResponse(
  store: ProviderStore,
  request: Request,
): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer rk_test_[A-Za-z0-9]+$/.test(authorization)) {
    return json({
      error: {
        type: "invalid_request_error",
        message: "Synthetic test credentials required",
      },
    }, 401);
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const body = method === "GET"
    ? new URLSearchParams(url.search)
    : await form(request);
  const response = await store.update((state) => {
    if (method === "POST" && path === "/v2/core/accounts") {
      return json(idempotent(state, request, "account", () => {
        const id = nextId(state, "acct");
        const account = connectAccount(id, state.stripe.accountMode);
        state.stripe.accounts[id] = account;
        return account;
      }));
    }
    const accountMatch = path.match(
      /^\/v2\/core\/accounts\/(acct_[A-Za-z0-9_]+)$/,
    );
    if (method === "GET" && accountMatch) {
      const existing = state.stripe.accounts[accountMatch[1]];
      if (!existing) return stripeMissing("account");
      const account = connectAccount(accountMatch[1], state.stripe.accountMode);
      state.stripe.accounts[accountMatch[1]] = account;
      return json(account);
    }
    if (method === "POST" && path === "/v1/account_sessions") {
      const accountId = requireParam(body, "account");
      if (!state.stripe.accounts[accountId]) return stripeMissing("account");
      return json(idempotent(state, request, "account_session", () => {
        const id = nextId(state, "cas");
        const session = {
          id,
          object: "account_session",
          account: accountId,
          client_secret: `${id}_secret_synthetic`,
          livemode: false,
        };
        state.stripe.accountSessions[id] = session;
        return session;
      }));
    }
    const loginMatch = path.match(
      /^\/v1\/accounts\/(acct_[A-Za-z0-9_]+)\/login_links$/,
    );
    if (method === "POST" && loginMatch) {
      if (!state.stripe.accounts[loginMatch[1]]) {
        return stripeMissing("account");
      }
      const id = nextId(state, "link");
      return json({
        id,
        object: "login_link",
        created: epoch(),
        url: `https://connect.stripe.com/express/${id}`,
      });
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      if (state.stripe.checkoutCreateMode === "failed") {
        return stripeUnavailable("checkout create failed");
      }
      const result = json(idempotent(
        state,
        request,
        "checkout",
        () => createCheckoutSession(state, body),
      ));
      return state.stripe.checkoutCreateMode === "commit_then_unknown"
        ? unknownAfterCommit(result, "checkout")
        : result;
    }
    const checkoutMatch = path.match(
      /^\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9_]+)$/,
    );
    if (method === "GET" && checkoutMatch) {
      return existingOrMissing(
        state.stripe.checkoutSessions,
        checkoutMatch[1],
        "checkout.session",
      );
    }
    const expireMatch = path.match(
      /^\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9_]+)\/expire$/,
    );
    if (method === "POST" && expireMatch) {
      try {
        return json(expireSession(state, expireMatch[1]));
      } catch {
        return stripeMissing("checkout.session");
      }
    }
    const resource = resourceRoute(path);
    if (resource && method === "GET") {
      const table = stripeTable(state, resource.kind);
      return existingOrMissing(table, resource.id, resource.kind);
    }
    if (method === "GET" && path === "/v1/refunds") {
      const chargeId = body.get("charge");
      const data = Object.values(state.stripe.refunds).filter((item) =>
        !chargeId || reference(item.charge) === chargeId
      );
      return json({
        object: "list",
        data,
        has_more: false,
        url: "/v1/refunds",
      });
    }
    if (method === "POST" && path === "/v1/refunds") {
      try {
        const sourceId = body.get("charge") ?? body.get("payment_intent");
        if (!sourceId) throw new Error("Missing refund source");
        const result = json(idempotent(
          state,
          request,
          "refund",
          () => refundForCharge(state, sourceId, body, state.stripe.refundMode),
        ));
        return state.stripe.refundMode === "commit_then_unknown"
          ? unknownAfterCommit(result, "refund")
          : result;
      } catch {
        return stripeMissing("charge");
      }
    }
    const refundUpdate = path.match(/^\/v1\/refunds\/(re_[A-Za-z0-9_]+)$/);
    if (method === "POST" && refundUpdate) {
      const refund = state.stripe.refunds[refundUpdate[1]];
      if (!refund) return stripeMissing("refund");
      refund.metadata = nested(body, "metadata");
      return json(refund);
    }
    const feeRefunds = path.match(
      /^\/v1\/application_fees\/(fee_[A-Za-z0-9_]+)\/refunds(?:\/(fr_[A-Za-z0-9_]+))?$/,
    );
    if (method === "GET" && feeRefunds) {
      const fee = state.stripe.applicationFees[feeRefunds[1]];
      if (!fee) return stripeMissing("application_fee");
      const refunds =
        ((fee.refunds as { data?: unknown[] } | undefined)?.data ??
          []) as Record<string, unknown>[];
      return feeRefunds[2]
        ? existingOrMissing(
          Object.fromEntries(refunds.map((item) => [String(item.id), item])),
          feeRefunds[2],
          "fee_refund",
        )
        : json({
          object: "list",
          data: refunds,
          has_more: false,
          url: `${path}`,
        });
    }
    const reversals = path.match(
      /^\/v1\/transfers\/(tr_[A-Za-z0-9_]+)\/reversals(?:\/(trr_[A-Za-z0-9_]+))?$/,
    );
    if (reversals && method === "POST" && !reversals[2]) {
      const transfer = state.stripe.transfers[reversals[1]];
      if (!transfer) return stripeMissing("transfer");
      const reversal = {
        id: nextId(state, "trr"),
        object: "transfer_reversal",
        amount: number(body.get("amount"), 0),
        currency: transfer.currency,
        source_refund: body.get("metadata[refund_id]") ?? null,
        livemode: false,
        metadata: nested(body, "metadata"),
      };
      (transfer.reversals as { data: Record<string, unknown>[] }).data.push(
        reversal,
      );
      return json(reversal);
    }
    if (reversals && method === "GET" && reversals[2]) {
      const transfer = state.stripe.transfers[reversals[1]];
      const data = (transfer?.reversals as
        | { data?: Record<string, unknown>[] }
        | undefined)?.data ?? [];
      return existingOrMissing(
        Object.fromEntries(data.map((item) => [String(item.id), item])),
        reversals[2],
        "transfer_reversal",
      );
    }
    return json({
      error: {
        type: "invalid_request_error",
        message: `Unsupported synthetic Stripe path ${method} ${path}`,
      },
    }, 400);
  });
  const unknown = response.headers.get("x-spec14-unknown-after-commit");
  if (unknown) {
    throw new Error(
      unknown === "checkout"
        ? "Simulated unknown checkout create outcome"
        : "Simulated unknown refund outcome",
    );
  }
  return response;
}

function resourceRoute(
  path: string,
): {
  kind:
    | "payment_intent"
    | "charge"
    | "application_fee"
    | "transfer"
    | "refund"
    | "dispute";
  id: string;
} | null {
  const definitions = [
    ["payment_intent", /^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/],
    ["charge", /^\/v1\/charges\/(ch_[A-Za-z0-9_]+)$/],
    ["application_fee", /^\/v1\/application_fees\/(fee_[A-Za-z0-9_]+)$/],
    ["transfer", /^\/v1\/transfers\/(tr_[A-Za-z0-9_]+)$/],
    ["refund", /^\/v1\/refunds\/(re_[A-Za-z0-9_]+)$/],
    ["dispute", /^\/v1\/disputes\/(dp_[A-Za-z0-9_]+)$/],
  ] as const;
  for (const [kind, pattern] of definitions) {
    const match = path.match(pattern);
    if (match) return { kind, id: match[1] };
  }
  return null;
}

function stripeTable(
  state: ProviderState,
  kind: NonNullable<ReturnType<typeof resourceRoute>>["kind"],
): Record<string, Record<string, unknown>> {
  if (kind === "payment_intent") return state.stripe.paymentIntents;
  if (kind === "charge") return state.stripe.charges;
  if (kind === "application_fee") return state.stripe.applicationFees;
  if (kind === "transfer") return state.stripe.transfers;
  if (kind === "refund") return state.stripe.refunds;
  return state.stripe.disputes;
}

function connectAccount(
  id: string,
  mode: AccountMode,
): Record<string, unknown> {
  const active = mode === "ready";
  const restricted = mode === "restricted";
  const action = mode === "action_required";
  const capability = restricted ? "restricted" : active ? "active" : "pending";
  const detail = restricted
    ? [{ code: "restricted_other", resolution: "contact_stripe" }]
    : [];
  const requirements = action
    ? [{
      awaiting_action_from: "user",
      description: "Synthetic verification required",
      errors: [],
      impact: {},
      minimum_deadline: { status: "currently_due" },
      requested_reasons: [{ code: "routine_verification" }],
    }]
    : [];
  return {
    id,
    object: "v2.core.account",
    livemode: false,
    created: new Date().toISOString(),
    dashboard: "express",
    applied_configurations: ["recipient"],
    closed: false,
    defaults: {
      currency: "usd",
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
        requirements_collector: "stripe",
      },
    },
    configuration: {
      recipient: {
        applied: true,
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: capability, status_details: detail },
            payouts: { status: capability, status_details: detail },
          },
        },
      },
    },
    requirements: { entries: requirements },
  };
}

function createCheckoutSession(
  state: ProviderState,
  body: URLSearchParams,
): Record<string, unknown> {
  const id = nextId(state, "cs_test");
  const indexes = [
    ...new Set(
      [...body.keys()].flatMap((key) =>
        key.match(/^line_items\[(\d+)\]/)?.[1] ?? []
      ),
    ),
  ].sort((a, b) => Number(a) - Number(b));
  const lineItems = indexes.map((index) => {
    const quantity = number(body.get(`line_items[${index}][quantity]`), 1);
    const unitAmount = number(
      body.get(`line_items[${index}][price_data][unit_amount]`),
      0,
    );
    const currency = body.get(`line_items[${index}][price_data][currency]`) ??
      "usd";
    const metadata = nested(
      body,
      `line_items[${index}][price_data][product_data][metadata]`,
    );
    const description =
      body.get(`line_items[${index}][price_data][product_data][name]`) ??
        "Admission";
    return {
      id: nextId(state, "li"),
      object: "item",
      description,
      quantity,
      currency,
      amount_subtotal: quantity * unitAmount,
      amount_tax: 0,
      amount_discount: 0,
      amount_total: quantity * unitAmount,
      price: {
        id: nextId(state, "price"),
        object: "price",
        livemode: false,
        type: "one_time",
        currency,
        unit_amount: unitAmount,
        product: {
          id: nextId(state, "prod"),
          object: "product",
          livemode: false,
          name: description,
          metadata,
        },
      },
    };
  });
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount_total, 0);
  const metadata = nested(body, "metadata");
  const currency = lineItems[0]?.currency ?? body.get("currency") ?? "usd";
  const session: Record<string, unknown> = {
    id,
    object: "checkout.session",
    livemode: false,
    mode: body.get("mode") ?? "payment",
    status: "open",
    payment_status: "unpaid",
    currency,
    amount_subtotal: subtotal,
    amount_total: subtotal,
    customer_email: body.get("customer_email"),
    expires_at: number(body.get("expires_at"), epoch() + 3600),
    client_reference_id: body.get("client_reference_id"),
    success_url: body.get("success_url"),
    cancel_url: body.get("cancel_url"),
    integration_identifier: body.get("integration_identifier"),
    metadata,
    automatic_tax: { enabled: body.get("automatic_tax[enabled]") === "true" },
    url: `https://checkout.stripe.com/c/pay/${id}`,
    payment_intent: null,
    customer: null,
    line_items: {
      object: "list",
      data: lineItems,
      has_more: false,
      url: `/v1/checkout/sessions/${id}/line_items`,
    },
    _synthetic: {
      applicationFeeAmount: number(
        body.get("payment_intent_data[application_fee_amount]"),
        0,
      ),
      destination: body.get("payment_intent_data[transfer_data][destination]"),
      metadata: nested(body, "payment_intent_data[metadata]"),
    },
  };
  state.stripe.checkoutSessions[id] = session;
  return session;
}

async function completeCheckout(
  store: ProviderStore,
  config: ProviderBoundaryConfig,
  sessionId: string,
): Promise<CompletedCheckout> {
  return await store.update(async (state) => {
    const session = state.stripe.checkoutSessions[sessionId];
    if (!session) throw new Error("Unknown checkout session");
    const synthetic = session._synthetic as {
      applicationFeeAmount?: number;
      destination?: string | null;
      metadata?: Record<string, string>;
      completion?: {
        eventId: string;
        paymentIntentId: string;
        chargeId: string;
        applicationFeeId: string;
        transferId: string;
      };
    };
    if (synthetic.completion) {
      const event = state.stripe.events[synthetic.completion.eventId];
      if (!event) throw new Error("Checkout completion state is invalid");
      return {
        event,
        signature: await createStripeSignature(
          JSON.stringify(event),
          config.stripeWebhookSecret,
        ),
        paymentIntentId: synthetic.completion.paymentIntentId,
        chargeId: synthetic.completion.chargeId,
        applicationFeeId: synthetic.completion.applicationFeeId,
        transferId: synthetic.completion.transferId,
      };
    }
    const amount = number(session.amount_total, 0),
      currency = String(session.currency);
    const paymentIntentId = nextId(state, "pi"),
      chargeId = nextId(state, "ch"),
      applicationFeeId = nextId(state, "fee"),
      transferId = nextId(state, "tr"),
      balanceId = nextId(state, "txn"),
      customerId = nextId(state, "cus");
    const fee = {
      id: applicationFeeId,
      object: "application_fee",
      livemode: false,
      amount: synthetic.applicationFeeAmount ?? 0,
      amount_refunded: 0,
      currency,
      charge: chargeId,
      originating_transaction: chargeId,
      account: synthetic.destination,
      refunds: { object: "list", data: [], has_more: false },
    };
    const transfer = {
      id: transferId,
      object: "transfer",
      livemode: false,
      amount,
      amount_reversed: 0,
      currency,
      destination: synthetic.destination,
      source_transaction: chargeId,
      reversals: { object: "list", data: [], has_more: false },
    };
    const charge = {
      id: chargeId,
      object: "charge",
      livemode: false,
      amount,
      amount_captured: amount,
      amount_refunded: 0,
      currency,
      paid: true,
      captured: true,
      refunded: false,
      disputed: false,
      status: "succeeded",
      payment_intent: paymentIntentId,
      application_fee: applicationFeeId,
      application_fee_amount: synthetic.applicationFeeAmount ?? 0,
      transfer: transferId,
      balance_transaction: balanceId,
      customer: customerId,
      metadata: synthetic.metadata ?? {},
      refunds: { object: "list", data: [], has_more: false },
    };
    const paymentIntent = {
      id: paymentIntentId,
      object: "payment_intent",
      livemode: false,
      amount,
      amount_received: amount,
      amount_capturable: 0,
      currency,
      status: "succeeded",
      latest_charge: charge,
      application_fee_amount: synthetic.applicationFeeAmount ?? 0,
      transfer_data: { destination: synthetic.destination },
      metadata: synthetic.metadata ?? {},
    };
    Object.assign(session, {
      status: "complete",
      payment_status: "paid",
      payment_intent: paymentIntent,
      customer: customerId,
    });
    state.stripe.paymentIntents[paymentIntentId] = paymentIntent;
    state.stripe.charges[chargeId] = charge;
    state.stripe.applicationFees[applicationFeeId] = fee;
    state.stripe.transfers[transferId] = transfer;
    const event = makeEvent(state, "checkout.session.completed", sessionId);
    synthetic.completion = {
      eventId: String(event.id),
      paymentIntentId,
      chargeId,
      applicationFeeId,
      transferId,
    };
    return {
      event,
      signature: await createStripeSignature(
        JSON.stringify(event),
        config.stripeWebhookSecret,
      ),
      paymentIntentId,
      chargeId,
      applicationFeeId,
      transferId,
    };
  });
}

function expireSession(
  state: ProviderState,
  sessionId: string,
): Record<string, unknown> {
  const session = state.stripe.checkoutSessions[sessionId];
  if (!session) throw new Error("Unknown checkout session");
  session.status = "expired";
  session.payment_status = "unpaid";
  return session;
}

function refundForCharge(
  state: ProviderState,
  sourceId: string,
  params?: URLSearchParams,
  mode: RefundMode = "succeeded",
): Record<string, unknown> {
  const chargeId = sourceId.startsWith("pi_")
    ? reference(state.stripe.paymentIntents[sourceId]?.latest_charge)
    : sourceId;
  if (!chargeId) throw new Error("Unknown payment intent");
  const charge = state.stripe.charges[chargeId];
  if (!charge) throw new Error("Unknown charge");
  const id = nextId(state, "re"),
    amount = number(params?.get("amount"), number(charge.amount, 0));
  const status = mode === "processing"
    ? "pending"
    : mode === "failed"
    ? "failed"
    : "succeeded";
  const refund: Record<string, unknown> = {
    id,
    object: "refund",
    amount: mode === "anomaly" ? amount + 1 : amount,
    currency: charge.currency,
    charge: chargeId,
    payment_intent: charge.payment_intent,
    status,
    reason: params?.get("reason") ?? null,
    metadata: nested(params ?? new URLSearchParams(), "metadata"),
    _synthetic: {
      amount,
      reverseTransfer: params?.get("reverse_transfer") === "true",
      refundApplicationFee: params?.get("refund_application_fee") === "true",
    },
  };
  state.stripe.refunds[id] = refund;
  (charge.refunds as { data: Record<string, unknown>[] }).data.push(refund);
  if (status === "succeeded" && mode !== "anomaly") {
    applyRefundEffects(state, refund);
  }
  return refund;
}

function applyRefundMode(
  state: ProviderState,
  refundId: string,
  mode: RefundMode,
): void {
  const refund = state.stripe.refunds[refundId];
  if (!refund) throw new Error("Unknown refund");
  const synthetic = refund._synthetic as { amount?: number } | undefined;
  const amount = number(synthetic?.amount, number(refund.amount, 0));
  refund.amount = mode === "anomaly" ? amount + 1 : amount;
  refund.status = mode === "processing"
    ? "pending"
    : mode === "failed"
    ? "failed"
    : "succeeded";
  if (mode === "succeeded" || mode === "commit_then_unknown") {
    applyRefundEffects(state, refund);
  }
}

function applyRefundEffects(
  state: ProviderState,
  refund: Record<string, unknown>,
): void {
  const charge = state.stripe.charges[String(refund.charge)];
  if (!charge) throw new Error("Unknown refund charge");
  const synthetic = refund._synthetic as {
    amount?: number;
    reverseTransfer?: boolean;
    refundApplicationFee?: boolean;
  } | undefined;
  const amount = number(synthetic?.amount, number(refund.amount, 0));
  const refunds = charge.refunds as { data: Record<string, unknown>[] };
  charge.amount_refunded = refunds.data
    .filter((item) =>
      item.status === "succeeded" && item.amount === charge.amount
    )
    .reduce((sum, item) => sum + number(item.amount, 0), 0);
  charge.refunded =
    number(charge.amount_refunded, 0) >= number(charge.amount, 0);
  const transfer = state.stripe.transfers[String(charge.transfer)];
  if (synthetic?.reverseTransfer && transfer && !refund.transfer_reversal) {
    const reversal = {
      id: nextId(state, "trr"),
      object: "transfer_reversal",
      amount: Math.min(amount, number(transfer.amount, 0)),
      currency: charge.currency,
      source_refund: refund.id,
      transfer: transfer.id,
      livemode: false,
      metadata: {},
    };
    (transfer.reversals as { data: Record<string, unknown>[] }).data.push(
      reversal,
    );
    transfer.amount_reversed = number(transfer.amount_reversed, 0) +
      number(reversal.amount, 0);
    refund.transfer_reversal = reversal.id;
  }
  const fee = state.stripe.applicationFees[String(charge.application_fee)];
  if (synthetic?.refundApplicationFee && fee && !refund._syntheticFeeRefund) {
    const feeRefund = {
      id: nextId(state, "fr"),
      object: "fee_refund",
      amount: number(fee.amount, 0),
      currency: charge.currency,
      fee: fee.id,
      metadata: {},
    };
    (fee.refunds as { data: Record<string, unknown>[] }).data.push(feeRefund);
    fee.amount_refunded = number(fee.amount_refunded, 0) +
      number(feeRefund.amount, 0);
    refund._syntheticFeeRefund = feeRefund.id;
  }
}

function makeEvent(
  state: ProviderState,
  type: string,
  objectId: string,
): Record<string, unknown> {
  const id = nextId(state, "evt");
  const event = {
    id,
    object: "event",
    type,
    livemode: false,
    api_version: "2026-07-29.dahlia",
    created: epoch(),
    data: { object: { id: objectId, object: objectKind(objectId) } },
  };
  state.stripe.events[id] = event;
  return event;
}

function objectKind(id: string): string {
  if (id.startsWith("cs_")) return "checkout.session";
  if (id.startsWith("re_")) return "refund";
  if (id.startsWith("dp_")) return "dispute";
  if (id.startsWith("acct_")) return "account";
  return "stripe.object";
}

async function resendResponse(
  store: ProviderStore,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed" }, 405);
  }
  const attemptKey = request.headers.get("idempotency-key") ?? "";
  if (!attemptKey) return json({ message: "Idempotency key required" }, 400);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const message = await store.update((state) => {
    const existing = state.email.messages.find((item) =>
      item.attemptKey === attemptKey
    );
    if (existing) return existing;
    const created = {
      attemptKey,
      providerId: nextId(state, "remsg"),
      mode: state.email.mode,
      payload,
      createdAt: new Date().toISOString(),
    };
    state.email.messages.push(created);
    return created;
  });
  if (message.mode === "accepted") return json({ id: message.providerId });
  if (message.mode === "failed") {
    return json({ message: "Synthetic provider rejection" }, 422);
  }
  throw new Error("Simulated unknown email outcome");
}

async function moderationResponse(
  store: ProviderStore,
  request: Request,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const mode = await store.update((state) => {
    state.moderation.requests.push(payload);
    return state.moderation.mode;
  });
  if (mode === "failed") {
    return json({ message: "Synthetic moderation failure" }, 503);
  }
  return json(
    mode === "approve"
      ? {
        outcome: "clear_candidate",
        riskLevel: "low",
        reasonCodes: ["no_violation"],
        providerReference: "spec14",
        modelVersion: "synthetic-1",
      }
      : {
        outcome: "review_required",
        riskLevel: "high",
        reasonCodes: ["other"],
        providerReference: "spec14",
        modelVersion: "synthetic-1",
      },
  );
}

function idempotent(
  state: ProviderState,
  request: Request,
  operation: string,
  create: () => Record<string, unknown>,
): Record<string, unknown> {
  const supplied = request.headers.get("idempotency-key") ?? "";
  if (!supplied) return create();
  const key = `${operation}:${supplied}`;
  const prior = state.idempotency[key];
  if (prior) return lookupById(state, prior) ?? create();
  const value = create();
  state.idempotency[key] = String(value.id);
  return value;
}

function lookupById(
  state: ProviderState,
  id: string,
): Record<string, unknown> | undefined {
  return state.stripe.accounts[id] ?? state.stripe.accountSessions[id] ??
    state.stripe.checkoutSessions[id] ?? state.stripe.refunds[id];
}

function existingOrMissing(
  table: Record<string, Record<string, unknown>>,
  id: string,
  kind: string,
): Response {
  return table[id] ? json(table[id]) : stripeMissing(kind);
}

function stripeMissing(kind: string): Response {
  return json({
    error: {
      type: "invalid_request_error",
      code: "resource_missing",
      message: `No such synthetic ${kind}`,
    },
  }, 404);
}

async function form(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  if (
    (request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      const result = new URLSearchParams();
      flatten(value, "", result);
      return result;
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

function flatten(
  value: unknown,
  prefix: string,
  output: URLSearchParams,
): void {
  if (Array.isArray(value)) {
    return value.forEach((item, index) =>
      flatten(item, `${prefix}[${index}]`, output)
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).forEach(([key, item]) =>
      flatten(item, prefix ? `${prefix}[${key}]` : key, output)
    );
  }
  if (value !== undefined && value !== null) output.set(prefix, String(value));
}

function nested(
  params: URLSearchParams,
  prefix: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    const match = key.match(
      new RegExp(`^${escapeRegex(prefix)}\\[([^\\]]+)\\]$`),
    );
    if (match) result[match[1]] = value;
  }
  return result;
}

function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function number(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}
function reference(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : value && typeof value === "object"
    ? String((value as { id?: unknown }).id)
    : undefined;
}
function epoch(): number {
  return Math.floor(Date.now() / 1000);
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function createStripeSignature(
  rawBody: string,
  secret: string,
  timestamp = epoch(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    ),
  );
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}
