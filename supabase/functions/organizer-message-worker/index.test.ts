import { assertEquals } from "@std/assert";
import { createOrganizerMessageWorkerHandler } from "./index.ts";
const secret = "s".repeat(40),
  key = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const env: Record<string, string> = {
  ORGANIZER_MESSAGE_WORKER_ENABLED: "true",
  ORGANIZER_MESSAGE_WORKER_SECRET: secret,
  RESEND_API_KEY: "re_fixture",
  TICKET_EMAIL_PAYLOAD_KEY_ID: "fixture",
  TICKET_EMAIL_PAYLOAD_KEYS_JSON: JSON.stringify({ fixture: key }),
};
const request = (authorization = `Bearer ${secret}`) =>
  new Request("https://worker.example", {
    method: "POST",
    headers: { authorization },
  });
Deno.test("worker defaults off and validates provider and encryption BEFORE heartbeat", async () => {
  for (
    const missing of [
      "ORGANIZER_MESSAGE_WORKER_ENABLED",
      "ORGANIZER_MESSAGE_WORKER_SECRET",
      "RESEND_API_KEY",
      "TICKET_EMAIL_PAYLOAD_KEY_ID",
      "TICKET_EMAIL_PAYLOAD_KEYS_JSON",
    ]
  ) {
    let calls = 0;
    const h = createOrganizerMessageWorkerHandler({
      readEnv: (n) => n === missing ? undefined : env[n],
      rpc: async () => {
        calls++;
        return true;
      },
      now: Date.now,
      fetch: () => {
        throw Error("Network forbidden");
      },
    });
    assertEquals((await h(request())).status, 503);
    assertEquals(calls, 0);
  }
});
Deno.test("worker authenticates, acknowledges health then independently claims without browser", async () => {
  const calls: string[] = [];
  const h = createOrganizerMessageWorkerHandler({
    readEnv: (n) => env[n],
    rpc: async (n) => {
      calls.push(n);
      return n === "server_acknowledge_organizer_message_worker" ? true : null;
    },
    now: Date.now,
    fetch: () => {
      throw Error("Network forbidden");
    },
  });
  assertEquals((await h(request("Bearer wrong"))).status, 401);
  assertEquals(calls, []);
  assertEquals(await (await h(request())).json(), { state: "idle" });
  assertEquals(calls, [
    "server_acknowledge_organizer_message_worker",
    "server_claim_organizer_message_recipient",
  ]);
});
Deno.test("worker yields when SQL health is denied without claiming", async () => {
  const calls: string[] = [];
  const handler = createOrganizerMessageWorkerHandler({
    readEnv: (n) => env[n],
    rpc: async (name) => {
      calls.push(name);
      return false;
    },
    now: Date.now,
    fetch: () => {
      throw Error("Network forbidden");
    },
  });
  assertEquals((await handler(request())).status, 503);
  assertEquals(calls, ["server_acknowledge_organizer_message_worker"]);
});
