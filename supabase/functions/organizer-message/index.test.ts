import { assertEquals } from "@std/assert";
import { createOrganizerMessageHandler } from "./index.ts";
const eventId = "550e8400-e29b-41d4-a716-446655440000",
  requestId = "550e8400-e29b-41d4-a716-446655440001";
const submit = {
  action: "submit",
  eventId,
  requestId,
  selector: { kind: "everyone" },
  subject: "Hello",
  body: "World",
  fingerprint: "a".repeat(64),
};
const request = (body: unknown, auth = true) =>
  new Request("https://api.example/organizer-message", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
      ...(auth ? { authorization: "Bearer owner-jwt" } : {}),
    },
    body: JSON.stringify(body),
  });
Deno.test("facade requires JWT and rejects arbitrary recipients before RPC", async () => {
  let calls = 0;
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => {
      calls++;
      throw new Error();
    },
  });
  assertEquals((await handler(request(submit, false))).status, 401);
  assertEquals(
    (await handler(request({ ...submit, recipients: ["x@example.com"] })))
      .status,
    400,
  );
  assertEquals(calls, 0);
});
Deno.test("facade owner JWT submit returns only receipt and preserves same request identity", async () => {
  const receipt = {
    messageId: eventId,
    requestId,
    queuedRecipients: 2,
    confirmedAt: "2026-09-23T12:00:00Z",
  };
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async (token, name, args) => {
      assertEquals(token, "owner-jwt");
      assertEquals(name, "submit_owned_organizer_message");
      assertEquals(args.p_request_id, requestId);
      return { data: receipt, error: null };
    },
  });
  assertEquals(await (await handler(request(submit))).json(), { receipt });
});
Deno.test("only SQL domain rollback proves submit not queued; transport/malformed remains unknown", async () => {
  for (const mode of ["domain", "network", "malformed", "other"]) {
    const handler = createOrganizerMessageHandler({
      appOrigin: "https://app.example",
      rpc: async () => {
        if (mode === "network") throw Error("secret");
        return mode === "malformed"
          ? { data: { secret: "recipient@example.com" }, error: null }
          : {
            data: null,
            error: {
              code: mode === "domain" ? "P0001" : "XX000",
              message: "LIMIT_REACHED",
            },
          };
      },
    });
    const result = await (await handler(request(submit))).json();
    assertEquals(
      result.error.submissionOutcome,
      mode === "domain" ? "not_queued" : "unknown",
    );
    assertEquals(JSON.stringify(result).includes("secret"), false);
  }
});
Deno.test("structured preview domain rejection is not rendered", async () => {
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => ({
      data: { error: { code: "AUDIENCE_UNAVAILABLE" } },
      error: null,
    }),
  });
  const preview = {
    eventId,
    selector: submit.selector,
    subject: submit.subject,
    body: submit.body,
  };
  const res = await handler(request({ ...preview, action: "preview" }));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: { code: "AUDIENCE_UNAVAILABLE" } });
});
Deno.test("preview projects frozen rendered email, exact count and no private fields", async () => {
  const facts = {
    eventId,
    eventName: "Night",
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
  const data = {
    recipientCount: 0,
    canSend: false,
    reason: "NO_RECIPIENTS",
    audienceLabel: "Everyone",
    deadline: "2026-09-30T14:00:00Z",
    fingerprint: "a".repeat(64),
    subject: "Hello",
    body: "World",
    facts,
  };
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => ({ data, error: null }),
  });
  const res = await handler(
    request({
      action: "preview",
      eventId,
      selector: { kind: "everyone" },
      subject: "Hello",
      body: "World",
    }),
  );
  const response = await res.json();
  assertEquals(res.status, 200);
  assertEquals(response.preview.recipientCount, 0);
  assertEquals(response.preview.canSend, false);
  assertEquals(typeof response.preview.html, "string");
  assertEquals("facts" in response.preview, false);
  assertEquals("recipients" in response.preview, false);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
});
Deno.test("options and receipt have strict projections and null receipt stays unresolved", async () => {
  const options = {
    eventId,
    admissionType: "free",
    deadline: null,
    canSend: false,
    reason: "EMAIL_UNAVAILABLE",
    replyTo: null,
    tiers: [],
  };
  for (
    const data of [options, { ...options, recipients: ["secret@example.com"] }]
  ) {
    const handler = createOrganizerMessageHandler({
      appOrigin: "https://app.example",
      rpc: async () => ({ data, error: null }),
    });
    const res = await handler(request({ action: "options", eventId }));
    assertEquals(res.status, "recipients" in data ? 503 : 200);
    assertEquals((await res.text()).includes("secret@example.com"), false);
  }
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => ({ data: null, error: null }),
  });
  assertEquals(
    await (await handler(request({ action: "receipt", eventId, requestId })))
      .json(),
    { receipt: null },
  );
});
Deno.test("oversized UTF-8, invalid JSON, wrong content type and cross origin cannot reach RPC", async () => {
  let calls = 0;
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => {
      calls++;
      throw Error();
    },
  });
  for (
    const body of ["{", JSON.stringify({ ...submit, body: "😀".repeat(10000) })]
  ) {
    const res = await handler(
      new Request("https://api.example", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-jwt",
          "content-type": "application/json",
        },
        body,
      }),
    );
    assertEquals(res.status, 400);
  }
  assertEquals(
    (await handler(
      new Request("https://api.example", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-jwt",
          "content-type": "application/jsonp",
        },
        body: JSON.stringify(submit),
      }),
    )).status,
    400,
  );
  const cross = request(submit);
  cross.headers.set("origin", "https://evil.example");
  assertEquals((await handler(cross)).status, 403);
  assertEquals(calls, 0);
});
Deno.test("expired JWT is explicit unauthorized without claiming an earlier submit rolled back", async () => {
  const handler = createOrganizerMessageHandler({
    appOrigin: "https://app.example",
    rpc: async () => ({
      data: null,
      error: { code: "PGRST301", message: "JWT expired" },
    }),
  });
  const res = await handler(request(submit));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), {
    error: { code: "UNAUTHORIZED", submissionOutcome: "unknown" },
  });
});
