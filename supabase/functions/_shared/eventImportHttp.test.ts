import { assertEquals } from "@std/assert";
import { createImportHandler } from "./eventImportHttp.ts";
Deno.test("import HTTP authorizes before reading content and rejects foreign authority keys", async () => {
  const handler = createImportHandler("process", {
    origin: "http://127.0.0.1:3000",
    auth: () => Promise.resolve("12345678-1234-4123-8123-123456789abc"),
    rpc: () => Promise.resolve(true),
    token: () => "",
    fetch: () => Promise.reject(Error("No network")),
  });
  const call = (body: unknown) =>
    handler(
      new Request("http://localhost/import", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          authorization: "Bearer synthetic",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  assertEquals(
    (await call({
      operation: "continue",
      batchId: "12345678-1234-4123-8123-123456789abc",
      organizer_id: "bad",
    })).status,
    400,
  );
  assertEquals(
    (await handler(
      new Request("http://localhost/import", { method: "POST", body: "x" }),
    )).status,
    403,
  );
  const denied = createImportHandler("upload", {
    origin: "http://127.0.0.1:3000",
    auth: () => Promise.resolve(null),
    rpc: () => Promise.reject(Error("must not call")),
    token: () => "",
    fetch: () => Promise.reject(Error()),
  });
  assertEquals(
    (await denied(
      new Request("http://localhost/import", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          authorization: "Bearer bad",
        },
        body: "huge",
      }),
    )).status,
    401,
  );
});
Deno.test("continuations cap geocoding and imports at ten, and do not fetch provenance", async () => {
  const actor = "12345678-1234-4123-8123-123456789abc";
  let claims = 0, completed = 0, imports = 0, fetches = 0;
  const handler = createImportHandler("process", {
    origin: "http://localhost",
    auth: async () => actor,
    token: () => "synthetic",
    fetch: async (url) => {
      fetches++;
      assertEquals(new URL(url).hostname, "api.mapbox.com");
      return new Response("", { status: 503 });
    },
    rpc: async (name) => {
      if (name === "server_authorize_event_import") return true;
      if (name === "server_claim_event_import_work") {
        claims++;
        return {
          kind: "claimed",
          rowId: actor,
          token: actor,
          revision: 1,
          input: {
            address: "1 Market St",
            city: "San Francisco",
            postal_code: "94105",
          },
        };
      }
      if (name === "server_complete_event_import_geocode") {
        completed++;
        return true;
      }
      if (name === "server_get_event_import_progress") {
        return { selected: Array(10).fill(actor) };
      }
      if (name === "server_import_event_row") {
        imports++;
        return { kind: "imported", eventId: actor };
      }
      throw Error("unexpected RPC " + name);
    },
  });
  const r = await handler(
    new Request("http://localhost/process", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        authorization: "Bearer synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "continue", batchId: actor }),
    }),
  );
  assertEquals(r.status, 200);
  assertEquals([claims, completed, fetches, imports], [10, 10, 10, 10]);
});
Deno.test("malformed upload persists a zero-row failure and extra authority headers never reach rows", async () => {
  const actor = "12345678-1234-4123-8123-123456789abc";
  let captured: Record<string, unknown> = {};
  const handler = createImportHandler("upload", {
    origin: "http://localhost",
    auth: async () => actor,
    token: () => "",
    fetch: async () => {
      throw Error("never");
    },
    rpc: async (name, args) => {
      if (name === "server_authorize_event_import") return true;
      captured = args;
      return actor;
    },
  });
  for (
    const source of [
      "title,title\na,b",
      "title,organizer_id\na,b",
      '"unterminated',
    ]
  ) {
    const r = await handler(
      new Request(
        `http://localhost/upload?requestId=${actor}&filename=..%2Fevents.csv`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            authorization: "Bearer synthetic",
            "content-type": "text/csv",
          },
          body: source,
        },
      ),
    );
    assertEquals(r.status, 201);
    assertEquals(captured.p_rows, []);
    assertEquals(captured.p_error, "CSV_STRUCTURE_INVALID");
  }
});
