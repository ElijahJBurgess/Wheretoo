// Actual Free RSVP / collection HTTP handlers, real local RPCs, no external provider permission.
import { assert, assertEquals } from "@std/assert";
import { createFreeRsvpHandler } from "../../../../supabase/functions/_shared/freeRsvpHandler.ts";
import { createTicketCollectionHandler } from "../../../../supabase/functions/ticket-collection/index.ts";
import { hashAdmissionCredential } from "../../../../supabase/functions/_shared/ticketCredentials.ts";
const dir = ".superpowers/sdd/2026-09-24-csv-event-import-v1/";
const f = JSON.parse(
  await Deno.readTextFile(".superpowers/event-import-proof/browser.json"),
);
const event =
  JSON.parse(await Deno.readTextFile(dir + "supplement.json")).event;
assertEquals(f.api, "http://127.0.0.1:60321");
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(f.api + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: f.anon,
      authorization: `Bearer ${f.service}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  const b = t ? JSON.parse(t) : null;
  if (!r.ok) throw Error(b.message);
  return b;
}
const secret = new Uint8Array(32).fill(7),
  deps = {
    appOrigin: f.origin,
    getSecret: () => secret,
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    rpc,
  };
const create = createFreeRsvpHandler("create", deps),
  status = createFreeRsvpHandler("status", deps),
  requestId = crypto.randomUUID();
const bearer = "rsvp_" +
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const body = {
  eventId: event,
  quantity: 2,
  name: "HTTP Guest",
  email: "http@example.invalid",
  requestId,
  collectionBearer: bearer,
};
const req = (value: unknown) =>
  new Request(f.origin + "/free-rsvp", {
    method: "POST",
    headers: { origin: f.origin, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
const first = await create(req(body));
assertEquals(first.status, 200);
const receipt = await first.json();
assertEquals(receipt.kind, "confirmed");
assertEquals(await (await create(req(body))).json(), receipt);
assertEquals(
  await (await status(req({ requestId, collectionBearer: bearer }))).json(),
  receipt,
);
const collectionHandler = createTicketCollectionHandler({
  appOrigin: f.origin,
  getCredentialSecret: () => secret,
  findCollection: async () => null,
  findFreeCollection: (hash) =>
    rpc("server_lookup_free_ticket_collection", { p_access_hash: hash }),
});
const response = await collectionHandler(req({ collectionBearer: bearer }));
assertEquals(response.status, 200);
const resultBody = await response.json();
assertEquals(resultBody.kind, "ready");
const collection = resultBody.collection;
assertEquals(collection.tickets.length, 2);
const credential = collection.tickets[0].admissionCredential;
assert(credential);
const bytes = await hashAdmissionCredential(credential);
const hash = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
for (const expected of ["admitted", "already_used"]) {
  const rows = await rpc("server_redeem_organizer_ticket", {
    p_organizer_id: f.actors.owner,
    p_event_id: event,
    p_credential_hash: "\\x" + hash,
  });
  assertEquals(rows[0].outcome, expected);
}
const result = {
  freeRsvpHttp: true,
  idempotentStatus: true,
  realHmacCredentials: true,
  ordinaryCollection: true,
  checkIn: true,
  externalProviderRequests: 0,
};
await Deno.writeTextFile(dir + "consumer-http.json", JSON.stringify(result));
console.log(JSON.stringify(result));
