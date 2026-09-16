import { assertEquals, assertStringIncludes } from "@std/assert";
import { processTicketEmail } from "./ticketEmailWorker.ts";
import {
  type EncryptedEmailPayload,
  grantExpiresAt,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import { createTicketEmailHttpHandler } from "./ticketEmailHttp.ts";
const now = Date.parse("2026-09-12T12:00:00Z");
const id = "550e8400-e29b-41d4-a716-446655440000";
const grantId = "550e8400-e29b-41d4-a716-446655440001";
const leaseId = "550e8400-e29b-41d4-a716-446655440002";
const detail = {
  sourceKind: "paid_order",
  eventStatus: "cancelled",
  facts: null,
  quantity: 3,
  orderNumber: "WT-LATE",
  financialState: "review",
  totalMinor: 7000,
  tickets: [],
  canViewTickets: false,
};
Deno.test("cancellation status grant lasts thirty days independently of old schedule", () => {
  assertEquals(
    grantExpiresAt("event_cancellation", new Date(now).toISOString()),
    "2026-10-12T12:00:00.000Z",
  );
});
Deno.test("shared worker sends one private cancellation status message for a late payment with no tickets", async () => {
  let payload: EncryptedEmailPayload | null = null;
  const sent: ProviderEmailPayload[] = [];
  const state = await processTicketEmail({
    config: {
      from: "Whereto <tickets@example.invalid>",
      supportEmail: "support@example.invalid",
      appOrigin: "https://app.example",
      keyId: "current",
      keys: new Map([["current", new Uint8Array(32).fill(7)]]),
    },
    now: () => now,
    rpc: async (name, args = {}) => {
      if (name === "server_claim_ticket_email") {
        return {
          id,
          purpose: "event_cancellation",
          lease_id: leaseId,
          recovery_payload: null,
        };
      }
      if (name === "server_prepare_ticket_email_context") {
        return {
          kind: "ready",
          attemptId: id,
          purpose: "event_cancellation",
          grantId,
          preparedAt: new Date(now).toISOString(),
          expiresAt: "2026-10-12T12:00:00Z",
          scheduledEndAt: null,
          overflow: false,
          sources: [{
            email: "pat@example.invalid",
            recipientName: "Pat",
            eligible: true,
            purpose: "event_cancellation",
            detail,
            previousFacts: null,
          }],
          payload: null,
        };
      }
      if (name === "server_save_ticket_email_payload") {
        payload = args.p_payload as EncryptedEmailPayload;
        return true;
      }
      if (name === "server_begin_ticket_email_dispatch") {
        return {
          attemptId: id,
          grantId,
          payload,
          idempotencyKey: "ticket-email/" + id,
          leaseUntil: new Date(now + 120000).toISOString(),
          firstPossibleDispatchAt: new Date(now).toISOString(),
          dispatchCount: 1,
        };
      }
      return true;
    },
    send: async (request, key) => {
      assertEquals(key, "ticket-email/" + id);
      sent.push(request);
      return { outcome: "accepted", providerId: "synthetic-provider-id" };
    },
  });
  assertEquals(state, "accepted");
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0].text, "under review");
  assertStringIncludes(sent[0].text, "/event-status#em1_");
  assertEquals(
    /QR|refund is confirmed|tickets are valid/i.test(sent[0].text),
    false,
  );
});
Deno.test("event status HTTP projection never mints admission and fails closed on leaked fields", async () => {
  let extra = false;
  const handler = createTicketEmailHttpHandler("event_status", {
    appOrigin: "https://app.example",
    recoveryEnabled: false,
    keyId: "",
    keys: new Map(),
    fingerprintSecret: new Uint8Array(32).fill(8),
    getTrustedIp: () => "127.0.0.1",
    getCredentialSecret: () => {
      throw new Error("forbidden");
    },
    rpc: async (name) => {
      assertEquals(name, "server_read_event_status_access");
      return {
        kind: "ready",
        purpose: "event_cancellation",
        expiresAt: "2099-01-01T00:00:00Z",
        detail: { ...detail, ...(extra ? { credential: "forbidden" } : {}) },
      };
    },
  });
  const request = () =>
    new Request("https://edge.example", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: "em1_" + "a".repeat(42) + "A" }),
    });
  const good = await handler(request());
  assertEquals(good.status, 200);
  assertEquals((await good.json()).detail.tickets, []);
  extra = true;
  assertEquals((await handler(request())).status, 404);
});

Deno.test("fully Used change notices remain status-only without granting admission access", async () => {
  const { eventNoticeSourceSchema } = await import("./eventNotice.ts");
  const facts = {
    title: "Community gathering", description: null, category: "community",
    starts_at: "2026-09-13T12:00:00Z", ends_at: "2026-09-13T14:00:00Z",
    timezone: "America/Los_Angeles", venue_name: "Civic Hall", address_line1: "1 Main Street",
    address_line2: null, city: "San Francisco", region: "CA", postal_code: "94105",
    country_code: "US", mapbox_feature_id: null, latitude: 37.7, longitude: -122.4,
    admission_type: "free", capacity: null, disclosures: null,
  };
  const source = { email: "pat@example.invalid", recipientName: "Pat", eligible: true,
    purpose: "event_change", previousFacts: facts,
    detail: { sourceKind: "free_registration", eventStatus: "published", facts,
      quantity: 1, orderNumber: null, financialState: "not_applicable", totalMinor: null,
      tickets: [{ id, admissionLabel: "Free admission", status: "used", usedAt: "2026-09-12T12:00:00Z" }], canViewTickets: false } };
  assertEquals(eventNoticeSourceSchema.safeParse(source).success, true);
  assertEquals(eventNoticeSourceSchema.safeParse({ ...source, detail: { ...source.detail, canViewTickets: true } }).success, false);
});
