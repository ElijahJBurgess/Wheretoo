import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { createReportEventHandler, deriveReportFingerprints } from "./index.ts";
import { reportRequestSchema } from "./contracts.ts";

const appOrigin = "https://app.example";
const reportSecret = "report-fingerprint-test-secret-at-least-thirty-two";
const eventId = "29000000-0000-4000-8000-000000000001";

function request(body: unknown, origin = appOrigin): Request {
  return new Request("https://functions.example/report-event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": "203.0.113.24",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("report contract accepts only an event id and one bounded reason", () => {
  assertEquals(reportRequestSchema.parse({ eventId, reason: "unsafe" }), {
    eventId,
    reason: "unsafe",
  });
  assertThrows(() => reportRequestSchema.parse({ eventId, reason: "unknown" }));
  assertThrows(() =>
    reportRequestSchema.parse({
      eventId,
      reason: "unsafe",
      note: "please remove",
    })
  );
});

Deno.test("report fingerprints are independent HMAC digests and never return client address", async () => {
  const fingerprints = await deriveReportFingerprints(
    "203.0.113.24",
    reportSecret,
  );
  assertMatch(fingerprints.actorFingerprint, /^[a-f0-9]{64}$/);
  assertMatch(fingerprints.networkFingerprint, /^[a-f0-9]{64}$/);
  assertEquals(
    fingerprints.actorFingerprint === fingerprints.networkFingerprint,
    false,
  );
  assertEquals(JSON.stringify(fingerprints).includes("203.0.113.24"), false);
});

Deno.test("report endpoint returns bounded success for dedupe and safe not-found", async () => {
  const calls: unknown[] = [];
  const handler = createReportEventHandler({
    appOrigin,
    reportFingerprintSecret: reportSecret,
    submit: (payload) => {
      calls.push(payload);
      return Promise.resolve("duplicate");
    },
    clientAddress: () => "203.0.113.24",
  });
  const duplicate = await handler(request({ eventId, reason: "unsafe" }));
  assertEquals(duplicate.status, 202);
  assertEquals(await duplicate.json(), { status: "received" });
  assertEquals(JSON.stringify(calls).includes("203.0.113.24"), false);

  const notFound = createReportEventHandler({
    appOrigin,
    reportFingerprintSecret: reportSecret,
    submit: () => Promise.resolve("not_found"),
    clientAddress: () => "203.0.113.24",
  });
  const response = await notFound(request({ eventId, reason: "unsafe" }));
  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: { code: "EVENT_NOT_FOUND" } });
});

Deno.test("report endpoint rejects non-exact origin and malformed payload without calling the database", async () => {
  let calls = 0;
  const handler = createReportEventHandler({
    appOrigin,
    reportFingerprintSecret: reportSecret,
    submit: () => {
      calls += 1;
      return Promise.resolve("submitted");
    },
    clientAddress: () => "203.0.113.24",
  });
  const denied = await handler(
    request({ eventId, reason: "unsafe" }, "https://attacker.example"),
  );
  assertEquals(denied.status, 403);
  assertEquals(await denied.json(), { error: { code: "CORS_ORIGIN_DENIED" } });
  const malformed = await handler(request({ eventId, reason: "bad" }));
  assertEquals(malformed.status, 400);
  assertEquals(await malformed.json(), { error: { code: "INVALID_REQUEST" } });
  assertEquals(calls, 0);
});

Deno.test("report endpoint does not expose database failures", async () => {
  const handler = createReportEventHandler({
    appOrigin,
    reportFingerprintSecret: reportSecret,
    submit: () => Promise.reject(new Error("private database detail")),
    clientAddress: () => "203.0.113.24",
  });
  const response = await handler(request({ eventId, reason: "unsafe" }));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: { code: "INTERNAL_ERROR" } });
});
