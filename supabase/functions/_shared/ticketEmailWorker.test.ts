import { assertEquals, assertMatch } from "@std/assert";
import {
  processTicketEmail,
  type TicketEmailWorkerConfig,
  type TicketEmailWorkerDependencies,
} from "./ticketEmailWorker.ts";
import {
  decryptEmailPayload,
  type EncryptedEmailPayload,
  encryptEmailPayload,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
const attemptId = "550e8400-e29b-41d4-a716-446655440000",
  grantId = "550e8400-e29b-41d4-a716-446655440001",
  leaseId = "550e8400-e29b-41d4-a716-446655440002";
const now = Date.parse("2026-09-11T12:00:00Z"),
  key = new Uint8Array(32).fill(7);
const config: TicketEmailWorkerConfig = {
  from: "Whereto <tickets@example.invalid>",
  supportEmail: "support@example.invalid",
  appOrigin: "https://tickets.example.invalid",
  keyId: "current",
  keys: new Map([["current", key]]),
};
function source(kind = "paid_order") {
  return {
    sourceKind: kind,
    sourceId: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    organizerId: crypto.randomUUID(),
    email: "guest@example.invalid",
    recipientName: "Alex",
    quantity: 2,
    eventName: "Long-awaited event",
    startsAt: "2026-11-10T20:00:00Z",
    endsAt: "2026-11-11T04:00:00Z",
    timezone: "America/Los_Angeles",
    venueName: "The Hall",
    eligible: true,
    reason: null,
    admissions: [{
      admissionLabel: "General admission",
      position: 1,
      status: "used",
      usedAt: "2026-09-10T19:00:00Z",
    }, {
      admissionLabel: "General admission",
      position: 2,
      status: "valid",
      usedAt: null,
    }],
  };
}
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sent: { payload: ProviderEmailPayload; key: string }[] = [];
  const claim: Record<string, unknown> = {
    id: attemptId,
    purpose: "initial",
    lease_id: leaseId,
    lease_until: new Date(now + 120000).toISOString(),
    request_id: grantId,
    recovery_payload: null,
  };
  const context: Record<string, unknown> = {
    kind: "ready",
    attemptId,
    purpose: "initial",
    grantId,
    preparedAt: new Date(now).toISOString(),
    expiresAt: "2026-11-12T04:00:00Z",
    scheduledEndAt: source().endsAt,
    overflow: false,
    sources: [source()],
    payload: null,
  };
  let payload: EncryptedEmailPayload | null = null;
  let save = true;
  const dispatch: Record<string, unknown> = {
    attemptId,
    grantId,
    idempotencyKey: "ticket-email/" + attemptId,
    leaseUntil: new Date(now + 120000).toISOString(),
    firstPossibleDispatchAt: new Date(now).toISOString(),
    dispatchCount: 1,
  };
  const deps: TicketEmailWorkerDependencies = {
    config,
    now: () => now,
    rpc: async (name, args = {}) => {
      calls.push({ name, args });
      if (name === "server_claim_ticket_email") return claim;
      if (name === "server_prepare_ticket_email_context") return context;
      if (name === "server_save_ticket_email_payload") {
        payload = args.p_payload as EncryptedEmailPayload;
        return save;
      }
      if (name === "server_begin_ticket_email_dispatch") {
        return { ...dispatch, payload: context.payload ?? payload };
      }
      return true;
    },
    send: async (payload, key) => {
      sent.push({ payload, key });
      return { outcome: "accepted", providerId: "provider-id" };
    },
  };
  return {
    deps,
    calls,
    sent,
    claim,
    context,
    dispatch,
    setSave: (value: boolean) => save = value,
  };
}
Deno.test("worker freezes a 60-day purchase expiry, canonical recipient and mixed history before dispatch", async () => {
  const f = fixture();
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertEquals(f.sent.length, 1);
  assertEquals(f.sent[0].payload.to, "guest@example.invalid");
  assertEquals(f.sent[0].payload.replyTo, config.supportEmail);
  assertMatch(f.sent[0].payload.text, /2 existing tickets/);
  assertMatch(f.sent[0].payload.text, /Used/);
  assertMatch(f.sent[0].payload.text, /Valid/);
  assertMatch(f.sent[0].payload.text, /PST/);
  assertMatch(f.sent[0].payload.text, /November 11/);
  assertMatch(
    f.sent[0].payload.text,
    /https:\/\/tickets.example.invalid\/ticket-access#em1_/,
  );
  assertEquals(f.sent[0].payload.tags, [{
    name: "attempt_id",
    value: attemptId,
  }]);
  const names = f.calls.map((c) => c.name);
  assertEquals(
    names.indexOf("server_save_ticket_email_payload") <
      names.indexOf("server_begin_ticket_email_dispatch"),
    true,
  );
});
Deno.test("recovery decrypts canonical recipient and renders paid/free fixed collection snapshot", async () => {
  const f = fixture();
  f.claim.purpose = "recovery";
  f.context.purpose = "recovery";
  f.context.scheduledEndAt = null;
  f.context.expiresAt = new Date(now + 86400000).toISOString();
  f.context.sources = [source(), source("free_registration")].map((source) => ({
    ...source,
    email: "recovered@example.invalid",
  }));
  f.claim.recovery_payload = await encryptEmailPayload(
    { kind: "recovery_request", email: "recovered@example.invalid" },
    { kind: "recovery_request", requestId: grantId },
    "current",
    key,
  );
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertEquals(f.sent[0].payload.to, "recovered@example.invalid");
  assertMatch(f.sent[0].payload.text, /4 existing tickets/);
  assertMatch(f.sent[0].payload.text, /2 separate collections/);
  assertMatch(f.sent[0].payload.text, /24 hours/);
  assertEquals(
    f.calls.find((c) => c.name === "server_prepare_ticket_email_context")?.args
      .p_recovery_email,
    "recovered@example.invalid",
  );
});
Deno.test("retry decrypts and sends exact immutable payload despite changed current projection", async () => {
  const first = fixture();
  await processTicketEmail(first.deps);
  const envelope = first.calls.find((c) =>
    c.name === "server_save_ticket_email_payload"
  )!.args.p_payload as EncryptedEmailPayload;
  const decrypted = await decryptEmailPayload(envelope, {
    kind: "provider",
    attemptId,
    grantId,
  }, config.keys);
  const retry = fixture();
  retry.context.payload = envelope;
  retry.context.sources = [];
  retry.context.expiresAt = "2026-12-12T00:00:00Z";
  retry.dispatch.dispatchCount = 2;
  assertEquals(await processTicketEmail(retry.deps), "accepted");
  assertEquals(retry.sent, first.sent);
  assertEquals(decrypted.kind, "provider");
  assertEquals(
    retry.calls.some((c) => c.name === "server_save_ticket_email_payload"),
    false,
  );
});
Deno.test("unreadable payload, malformed projection, or a lost save lease prevents any dispatch", async () => {
  for (const mode of ["decrypt", "projection", "save", "expiry"]) {
    const f = fixture();
    if (mode === "decrypt") f.context.payload = {};
    if (mode === "projection") {
      f.context.sources = [{ ...source(), admissions: [] }];
    }
    if (mode === "save") f.setSave(false);
    if (mode === "expiry") f.context.expiresAt = "2026-10-01T00:00:00Z";
    await processTicketEmail(f.deps);
    assertEquals(f.sent.length, 0);
    assertEquals(
      f.calls.some((c) => c.name === "server_begin_ticket_email_dispatch"),
      false,
    );
  }
});
Deno.test("dispatch rejects stale lease, expired replay window and seventh call as Unknown", async () => {
  for (
    const change of [{ leaseUntil: new Date(now + 19999).toISOString() }, {
      firstPossibleDispatchAt: new Date(now - 23 * 3600000).toISOString(),
    }, { dispatchCount: 7 }]
  ) {
    const f = fixture();
    Object.assign(f.dispatch, change);
    assertEquals(await processTicketEmail(f.deps), "unknown");
    assertEquals(f.sent.length, 0);
    assertEquals(f.calls.at(-1)?.args.p_outcome, "unknown");
  }
});
Deno.test("a rejection is Failed only on initial dispatch; uncertainty survives replay exhaustion", async () => {
  for (
    const [count, transport, want] of [
      [1, "failed", "failed"],
      [2, "failed", "unknown"],
      [6, "unknown", "unknown"],
      [1, "unknown", "unknown"],
    ] as const
  ) {
    const f = fixture();
    f.dispatch.dispatchCount = count;
    f.deps.send = async () => ({ outcome: transport });
    assertEquals(await processTicketEmail(f.deps), want);
    assertEquals(f.calls.at(-1)?.args.p_outcome, want);
  }
});
Deno.test("missing configuration or support fails closed without provider access", async () => {
  for (const configuration of [null, { ...config, supportEmail: "" }]) {
    const f = fixture();
    f.deps.config = configuration;
    await processTicketEmail(f.deps);
    assertEquals(f.sent.length, 0);
    assertEquals(
      f.calls.some((c) => c.name === "server_begin_ticket_email_dispatch"),
      false,
    );
  }
});
Deno.test("overflow requires support and sends no access link or truncated collections", async () => {
  const f = fixture();
  f.claim.purpose = "recovery";
  f.context.purpose = "recovery";
  f.context.scheduledEndAt = null;
  f.context.expiresAt = new Date(now + 86400000).toISOString();
  f.context.overflow = true;
  f.context.sources = [];
  f.claim.recovery_payload = await encryptEmailPayload(
    { kind: "recovery_request", email: "guest@example.invalid" },
    { kind: "recovery_request", requestId: grantId },
    "current",
    key,
  );
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertEquals(/em1_|ticket-access|200/.test(f.sent[0].payload.text), false);
  assertMatch(f.sent[0].payload.text, /help you recover access/);
});
Deno.test("unreadable recovery never queries recipient membership and support absence stops only that attempt", async () => {
  const f = fixture();
  f.claim.purpose = "recovery";
  f.claim.recovery_payload = {};
  assertEquals(await processTicketEmail(f.deps), "payload_unreadable");
  assertEquals(
    f.calls.some((c) => c.name === "server_prepare_ticket_email_context"),
    false,
  );
  assertEquals(f.sent.length, 0);
  const missing = fixture();
  missing.deps.config = { ...config, supportEmail: "" };
  assertEquals(await processTicketEmail(missing.deps), "support_unconfigured");
  assertEquals(missing.calls.at(-1)?.args, {
    p_attempt_id: attemptId,
    p_lease_id: leaseId,
    p_reason: "support_unconfigured",
  });
});
Deno.test("payload swaps after durable begin and loss of finish lease do not invent acceptance", async () => {
  const f = fixture();
  const rpc = f.deps.rpc;
  f.deps.rpc = async (name, args) => {
    const result = await rpc(name, args);
    return name === "server_begin_ticket_email_dispatch"
      ? { ...(result as object), payload: {} }
      : result;
  };
  assertEquals(await processTicketEmail(f.deps), "unknown");
  assertEquals(f.sent.length, 0);
  const lost = fixture();
  const lostRpc = lost.deps.rpc;
  lost.deps.rpc = async (name, args) =>
    name === "server_finish_ticket_email_dispatch"
      ? false
      : await lostRpc(name, args);
  assertEquals(await processTicketEmail(lost.deps), "lease_lost");
});
Deno.test("canonical punctuation recipients survive initial, resend and recovery without substitution", async () => {
  for (
    const email of ["guest!vip@example.invalid", "guest%vip@example.invalid"]
  ) {
    for (const purpose of ["initial", "resend", "recovery"]) {
      const f = fixture();
      f.claim.purpose = purpose;
      f.context.purpose = purpose;
      f.context.sources = [{ ...source(), email }];
      if (purpose === "recovery") {
        f.context.scheduledEndAt = null;
        f.context.expiresAt = new Date(now + 86400000).toISOString();
        f.claim.recovery_payload = await encryptEmailPayload(
          { kind: "recovery_request", email },
          { kind: "recovery_request", requestId: grantId },
          "current",
          key,
        );
      }
      assertEquals(await processTicketEmail(f.deps), "accepted");
      assertEquals(f.sent[0].payload.to, email);
    }
  }
});
Deno.test("preparation resumes after a crash and reschedule using the persisted scheduled end", async () => {
  const f = fixture();
  f.context.scheduledEndAt = source().endsAt;
  f.context.sources = [{
    ...source(),
    startsAt: "2026-11-20T20:00:00Z",
    endsAt: "2026-11-21T04:00:00Z",
  }];
  assertEquals(f.context.payload, null);
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertEquals(f.context.expiresAt, "2026-11-12T04:00:00Z");
  assertMatch(f.sent[0].payload.text, /November 20/);
  assertMatch(f.sent[0].payload.text, /This link expires November 11/);
  assertEquals(
    f.calls.some((c) => c.name === "server_stop_ticket_email"),
    false,
  );
});
Deno.test("actual SQL multi-tier mixed projection dispatches every original ticket in collection order", async () => {
  const { default: prepared } = await import(
    "./ticketEmailWorkerProjection.fixture.json",
    { with: { type: "json" } }
  );
  const f = fixture();
  Object.assign(f.context, prepared);
  f.claim.id = prepared.attemptId;
  f.deps.now = () => Date.parse(prepared.preparedAt);
  Object.assign(f.dispatch, {
    attemptId: prepared.attemptId,
    grantId: prepared.grantId,
    idempotencyKey: "ticket-email/" + prepared.attemptId,
    leaseUntil: new Date(f.deps.now() + 120000).toISOString(),
    firstPossibleDispatchAt: prepared.preparedAt,
  });
  // The companion rollback SQL proves these are [1,1] original per-item units.
  assertEquals(prepared.sources[0].admissions.map((a) => a.position), [1, 2]);
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertMatch(f.sent[0].payload.text, /Ticket 1 of 2/);
  assertMatch(f.sent[0].payload.text, /Ticket 2 of 2/);
  assertMatch(f.sent[0].payload.text, /General Admission/);
  assertMatch(f.sent[0].payload.text, /VIP/);
  assertMatch(f.sent[0].payload.text, /Used/);
  assertMatch(f.sent[0].payload.text, /Valid/);
  assertEquals(f.sent[0].payload.to, "guest!vip@example.invalid");
});
Deno.test("recovery rejects a source from another canonical recipient before saving or dispatching", async () => {
  const f = fixture();
  f.claim.purpose = "recovery";
  f.context.purpose = "recovery";
  f.context.scheduledEndAt = null;
  f.context.expiresAt = new Date(now + 86400000).toISOString();
  f.context.sources = [source(), {
    ...source("free_registration"),
    email: "other@example.invalid",
  }];
  f.claim.recovery_payload = await encryptEmailPayload(
    { kind: "recovery_request", email: "guest@example.invalid" },
    { kind: "recovery_request", requestId: grantId },
    "current",
    key,
  );
  assertEquals(await processTicketEmail(f.deps), "invalid_projection");
  assertEquals(f.sent.length, 0);
  assertEquals(
    f.calls.some((c) =>
      c.name === "server_save_ticket_email_payload" ||
      c.name === "server_begin_ticket_email_dispatch"
    ),
    false,
  );
});

function refundFixture() {
  const f = fixture();
  f.claim.purpose = "refund_notice";
  f.context.purpose = "refund_notice";
  f.context.scheduledEndAt = null;
  f.context.expiresAt = "2026-10-11T12:00:00.000Z";
  f.context.sources = [{
    email: "guest@example.invalid",
    recipientName: "Alex",
    eligible: true,
    order: {
      orderNumber: "WT-123",
      eventName: "Past event",
      startsAt: "2026-08-10T20:00:00Z",
      endsAt: "2026-08-11T04:00:00Z",
      timezone: "America/Los_Angeles",
      venueName: "The Hall",
      currency: "usd",
      totalMinor: 7000,
      subtotalMinor: 7000,
      quantity: 3,
      items: [{ tierName: "GA", quantity: 2, subtotalMinor: 4000 }, {
        tierName: "VIP",
        quantity: 1,
        subtotalMinor: 3000,
      }],
      refundAmountMinor: 7000,
      completedAt: "2026-09-10T12:00:00Z",
      tickets: [{
        id: crypto.randomUUID(),
        admissionLabel: "GA",
        status: "used",
        usedAt: "2026-08-10T20:01:00Z",
      }, {
        id: crypto.randomUUID(),
        admissionLabel: "GA",
        status: "refunded",
        usedAt: null,
      }, {
        id: crypto.randomUUID(),
        admissionLabel: "VIP",
        status: "refunded",
        usedAt: null,
      }],
    },
  }];
  return f;
}
Deno.test("refund notice uses whole-order copy, private financial destination and existing sender", async () => {
  const f = refundFixture();
  assertEquals(await processTicketEmail(f.deps), "accepted");
  assertEquals(f.sent.length, 1);
  assertMatch(f.sent[0].payload.text, /\$70\.00/);
  assertMatch(f.sent[0].payload.text, /View order details/);
  assertMatch(f.sent[0].payload.text, /refund-details#em1_/);
  assertEquals(f.sent[0].payload.text.includes("ticket-access"), false);
  assertEquals(f.sent[0].payload.text.includes("ticket collection"), false);
  assertEquals(f.sent[0].key, `ticket-email/${attemptId}`);
});
Deno.test("refund notice rejects admission-active projections and altered fixed expiry before dispatch", async () => {
  for (const change of ["ticket", "expiry", "amount", "pii"]) {
    const f = refundFixture();
    const s = (f.context.sources as { order: Record<string, unknown> }[])[0];
    if (change === "ticket") {
      (s.order.tickets as { status: string }[])[1].status = "valid";
    }
    if (change === "expiry") f.context.expiresAt = "2026-10-12T12:00:00.000Z";
    if (change === "amount") s.order.refundAmountMinor = 6000;
    if (change === "pii") s.order.buyerEmail = "leak@example.invalid";
    assertEquals(await processTicketEmail(f.deps), "invalid_projection");
    assertEquals(f.sent.length, 0);
  }
});
