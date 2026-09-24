import { assertEquals, assertRejects } from "@std/assert";
import {
  organizerMessageRequestSchema,
  renderOrganizerMessage,
} from "./organizerMessage.ts";
export const eventId = "550e8400-e29b-41d4-a716-446655440000";
export const facts = {
  eventId,
  eventName: "Night <live>",
  organizerName: "Hosts",
  startsAt: "2026-09-23T12:00:00Z",
  endsAt: "2026-09-23T14:00:00Z",
  timezone: "UTC",
  venueName: "Hall",
  senderEmail: "events@wheretoo.example",
  replyTo: "support@wheretoo.example",
  templateVersion: "organizer-message-v1",
  eventUrl: null,
  flyerUrl: null,
  organizerLogoUrl: null,
};
Deno.test("message request rejects recipient overrides, header controls, invalid Unicode and code-point overflow", () => {
  const base = {
    action: "preview",
    eventId,
    selector: { kind: "everyone" },
    subject: "Hello",
    body: "World",
  };
  assertEquals(organizerMessageRequestSchema.safeParse(base).success, true);
  for (
    const change of [
      { to: "x@example.com" },
      { subject: "Hi\r\nBcc:x@example.com" },
      { body: "\u0000" },
      { subject: "😀".repeat(121) },
      { body: "a".repeat(5001) },
      { body: "\ud800" },
      { selector: { kind: "everyone", id: eventId } },
    ]
  ) {
    assertEquals(
      organizerMessageRequestSchema.safeParse({ ...base, ...change }).success,
      false,
    );
  }
  assertEquals(
    organizerMessageRequestSchema.safeParse({
      ...base,
      subject: "😀".repeat(120),
      body: "Hello\r\nworld",
    }).success,
    true,
  );
});
Deno.test("frozen message rendering escapes content, preserves lines and has no ticket access", async () => {
  const result = await renderOrganizerMessage(
    facts,
    "Hello <script>",
    "First\n<script>alert(1)</script>\nhttps://evil.example",
  );
  assertEquals(result.from, "Hosts via Wheretoo <events@wheretoo.example>");
  assertEquals(result.replyTo, facts.replyTo);
  assertEquals(result.html.includes("<script>"), false);
  assertEquals(result.html.includes("&lt;script&gt;"), true);
  assertEquals(result.html.includes('href="https://evil.example'), false);
  assertEquals(result.html.includes("ticket-access"), false);
  assertEquals(result.text.includes("First"), true);
  assertEquals(result.text.includes("when the organizer queued it"), true);
  await assertRejects(() =>
    renderOrganizerMessage(
      { ...facts, templateVersion: "future" },
      "Hi",
      "Body",
    )
  );
});
Deno.test("unsafe optional assets omitted and unsafe organizer name uses safe fallback", async () => {
  const result = await renderOrganizerMessage(
    {
      ...facts,
      organizerName: "Bad\r\nBcc:evil",
      eventUrl: "https://evil.example/ticket-access#token",
      flyerUrl: "https://evil.example/storage/v1/object/sign/private?token=x",
      organizerLogoUrl: "javascript:alert(1)",
    },
    "Hi",
    "Body",
  );
  assertEquals(
    result.from,
    "Event organizer via Wheretoo <events@wheretoo.example>",
  );
  assertEquals(result.html.includes("evil.example"), false);
  assertEquals(result.html.includes("javascript:"), false);
});
Deno.test("sender display punctuation is quoted without changing organizer identity", async () => {
  const result = await renderOrganizerMessage(
    { ...facts, organizerName: "Hosts, Inc." },
    "Hi",
    "Body",
  );
  assertEquals(
    result.from,
    '"Hosts, Inc. via Wheretoo" <events@wheretoo.example>',
  );
});
