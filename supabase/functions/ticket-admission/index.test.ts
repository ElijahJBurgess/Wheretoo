// deno-lint-ignore-file require-await
import { assertEquals, assertFalse, assertRejects } from "@std/assert";
import { createHash } from "node:crypto";
import { requireOrganizer } from "../_shared/auth.ts";
import {
  createTicketAdmissionHandler,
  defaultRedeem,
  type TicketAdmissionDependencies,
} from "./index.ts";

const ORIGIN = "https://whereto.example";
const EVENT = "a6200000-0000-4000-8000-000000000001";
const OWNER = "a6100000-0000-4000-8000-000000000001";
const CREDENTIAL = `wta1_${"A".repeat(43)}`;
const HASH = createHash("sha256").update(CREDENTIAL).digest("hex");
function request(
  body: unknown = { eventId: EVENT, credential: CREDENTIAL },
  token = "verified-jwt",
) {
  return new Request("https://functions.example/ticket-admission", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
function dependencies(
  overrides: Partial<TicketAdmissionDependencies> = {},
): TicketAdmissionDependencies {
  return {
    appOrigin: ORIGIN,
    verifyOrganizer: (req) =>
      requireOrganizer(req, {
        getUser: async (token) => ({
          user: token === "verified-jwt" ? { id: OWNER } : null,
          error: null,
        }),
        findOrganizerByUserId: async (id) => ({
          organizer: { id },
          error: null,
        }),
      }),
    redeem: async () => ({
      outcome: "admitted",
      admission_label: "General Admission",
    }),
    ...overrides,
  };
}
Deno.test("verified organizer and full credential hash are the only RPC inputs; safe exact response", async () => {
  let input: unknown;
  const response = await createTicketAdmissionHandler(
    dependencies({
      redeem: async (value) => {
        input = value;
        return { outcome: "admitted", admission_label: "General Admission" };
      },
    }),
  )(request());
  assertEquals(input, {
    organizerId: OWNER,
    eventId: EVENT,
    credentialHash: `\\x${HASH}`,
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    outcome: "admitted",
    admissionLabel: "General Admission",
  });
  assertEquals(response.headers.get("cache-control"), "private, no-store");
});
Deno.test("missing or rejected JWT cannot reach ticket truth", async () => {
  for (const token of ["", "forged-jwt"]) {
    let called = false;
    const response = await createTicketAdmissionHandler(
      dependencies({
        redeem: async () => {
          called = true;
          return null;
        },
      }),
    )(request(undefined, token));
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { outcome: "network_error" });
    assertFalse(called);
  }
});
Deno.test("exact body, strict event UUID and canonical admission credential reject before RPC", async () => {
  const valid = { eventId: EVENT, credential: CREDENTIAL };
  for (
    const body of [
      null,
      [],
      {},
      { ...valid, organizerId: OWNER },
      { eventId: EVENT },
      { ...valid, eventId: "not-uuid" },
      { ...valid, eventId: EVENT + "\n" },
      { ...valid, eventId: "00000000-0000-0000-0000-000000000000" },
      ...[
        "A".repeat(43),
        "wta1_" + "A".repeat(42) + "B",
        CREDENTIAL + "=",
        CREDENTIAL + "\n",
        ` ${CREDENTIAL}`,
        12,
      ].map((credential) => ({ ...valid, credential })),
    ]
  ) {
    let called = false;
    const response = await createTicketAdmissionHandler(
      dependencies({
        redeem: async () => {
          called = true;
          return null;
        },
      }),
    )(request(body));
    assertEquals(response.status, 400, JSON.stringify(body));
    assertEquals(await response.json(), { outcome: "network_error" });
    assertFalse(called);
  }
});
Deno.test("all six domain outcomes preserve HTTP 200 exact safe DTO", async () => {
  for (
    const outcome of [
      "admitted",
      "already_used",
      "refunded",
      "cancelled",
      "wrong_event",
      "invalid",
    ]
  ) {
    const admission_label = ["wrong_event", "invalid"].includes(outcome)
      ? null
      : "VIP";
    const response = await createTicketAdmissionHandler(
      dependencies({ redeem: async () => ({ outcome, admission_label }) }),
    )(request());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      outcome,
      ...(admission_label ? { admissionLabel: admission_label } : {}),
    });
  }
});
Deno.test("uncertain, malformed or leaking RPC responses never admit or expose internal truth", async () => {
  for (
    const value of [
      null,
      [],
      {},
      { outcome: "admitted", admission_label: null },
      { outcome: "admitted", admission_label: "" },
      { outcome: "admitted", admission_label: "VIP", credential: CREDENTIAL },
      { outcome: "unknown", admission_label: null },
      { outcome: ["admitted"], admission_label: "VIP" },
      { outcome: "wrong_event", admission_label: "Foreign VIP" },
    ]
  ) {
    const response = await createTicketAdmissionHandler(
      dependencies({ redeem: async () => value }),
    )(request());
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { outcome: "network_error" });
  }
  const response = await createTicketAdmissionHandler(
    dependencies({
      redeem: async () => {
        throw new Error(CREDENTIAL);
      },
    }),
  )(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { outcome: "network_error" });
});
Deno.test("method, origin, content type, malformed JSON and actual stream size are guarded", async () => {
  const handle = createTicketAdmissionHandler(
    dependencies({
      redeem: async () => {
        throw new Error("must not call");
      },
    }),
  );
  for (
    const [req, status] of [
      [
        new Request("https://functions.example", {
          headers: { origin: ORIGIN },
        }),
        405,
      ],
      [request(undefined), 403],
      [
        new Request("https://functions.example", {
          method: "POST",
          headers: { origin: ORIGIN },
          body: "{}",
        }),
        400,
      ],
      [
        new Request("https://functions.example", {
          method: "POST",
          headers: {
            origin: ORIGIN,
            authorization: "Bearer verified-jwt",
            "content-type": "application/json",
          },
          body: "{",
        }),
        400,
      ],
      [request({ eventId: EVENT, credential: "A".repeat(10000) }), 400],
    ] as const
  ) {
    if (status === 403) req.headers.set("origin", "https://evil.example");
    // Input validation follows successful organizer authentication.
    if (status === 400) req.headers.set("authorization", "Bearer verified-jwt");
    assertEquals((await handle(req)).status, status);
  }
});
Deno.test("service boundary uses exact RPC and bytea encoding and rejects DB failures", async () => {
  const input = {
    organizerId: OWNER,
    eventId: EVENT,
    credentialHash: `\\x${HASH}`,
  };
  let observed: unknown;
  const client = {
    rpc: async (...args: unknown[]) => {
      observed = args;
      return {
        data: [{ outcome: "admitted", admission_label: "VIP" }],
        error: null,
      };
    },
  };
  assertEquals(await defaultRedeem(input, client as never), {
    outcome: "admitted",
    admission_label: "VIP",
  });
  assertEquals(observed, ["server_redeem_organizer_ticket", {
    p_organizer_id: OWNER,
    p_event_id: EVENT,
    p_credential_hash: `\\x${HASH}`,
  }]);
  assertFalse(JSON.stringify(observed).includes(CREDENTIAL));
  for (
    const result of [
      { data: [], error: null },
      { data: [{}, {}], error: null },
      { data: null, error: { message: CREDENTIAL } },
    ]
  ) {
    await assertRejects(
      () => defaultRedeem(input, { rpc: async () => result } as never),
      Error,
      "Admission unavailable",
    );
  }
});
Deno.test("organizer scan includes safe guest and canonical previous use time", async () => {
 const response = await createTicketAdmissionHandler(dependencies({ redeem: async () => ({ outcome: "already_used", admission_label: "VIP", buyer_name: "Alex Chen", used_at: "2026-09-10T19:42:00Z" }) }))(request());
 assertEquals(response.status,200);
 assertEquals(await response.json(), { outcome: "already_used", admissionLabel: "VIP", attendeeLabel: "Alex Chen", usedAt: "2026-09-10T19:42:00Z" });
});
