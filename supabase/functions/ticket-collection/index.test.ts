// deno-lint-ignore-file require-await
import { assertEquals, assertFalse } from "@std/assert";
import { createHash, createHmac } from "node:crypto";
import {
  createTicketCollectionHandler,
  defaultFindCollection,
  type TicketCollectionDependencies,
} from "./index.ts";

const ORIGIN = "https://whereto.example";
const BEARER = "tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng";
const BEARER_HASH =
  "e09ec484378583aa52cadee9787fdee4dc67a764ab98c0883c9413f7c2cc53e1";
const SECRET = new Uint8Array(32).fill(7); // Synthetic, independent Node crypto oracle.
const ITEM = "a6400000-0000-4000-8000-000000000001";
const EVENT = "a6200000-0000-4000-8000-000000000001";
function credential(unit: number) {
  return "wta1_" +
    createHmac("sha256", SECRET).update(
      `wheretoo:paid-admission:lite:v1\n${ITEM}\n${unit}`,
    ).digest("base64url");
}
function projection() {
  return {
    event_id: EVENT,
    event_title: "Night Market",
    event_starts_at: "2026-09-09T18:00:00+00:00",
    event_ends_at: "2026-09-09T20:00:00+00:00",
    event_venue_name: null as string | null,
    event_status: "published",
    order_status: "paid",
    quantity: 3,
    items: [{
      order_item_id: ITEM,
      quantity: 3,
      admission_label: "General Admission",
    }],
    tickets: [1, 2, 3].map((unit) => ({
      id: `a6500000-0000-4000-8000-00000000000${unit}`,
      order_item_id: ITEM,
      unit_sequence: unit,
      admission_label: "General Admission",
      status: "valid",
      credential_hash: createHash("sha256").update(credential(unit)).digest(
        "hex",
      ),
    })),
  };
}
function dependencies(
  value: unknown = projection(),
  overrides: Partial<TicketCollectionDependencies> = {},
): TicketCollectionDependencies {
  return {
    appOrigin: ORIGIN,
    findCollection: async () => value,
    getCredentialSecret: () => SECRET,
    ...overrides,
  };
}
function request(
  body: unknown = { collectionBearer: BEARER },
  origin = ORIGIN,
) {
  return new Request("https://functions.example/ticket-collection", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function unavailable(
  value: unknown,
  overrides: Partial<TicketCollectionDependencies> = {},
) {
  const response = await createTicketCollectionHandler(
    dependencies(value, overrides),
  )(request());
  assertEquals(response.status, 404);
  assertEquals(await response.json(), { kind: "unavailable" });
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(response.headers.get("pragma"), "no-cache");
}

Deno.test("paid bearer returns exact shell DTO, stable selectors and independent credential vectors", async () => {
  let hash = "";
  const response = await createTicketCollectionHandler(
    dependencies(projection(), {
      findCollection: async (input) => {
        hash = input;
        return projection();
      },
    }),
  )(request());
  assertEquals(hash, BEARER_HASH);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(response.headers.get("pragma"), "no-cache");
  assertEquals(await response.json(), {
    kind: "ready",
    collection: {
      collectionLabel: "Night Market tickets",
      eventId: EVENT,
      tickets: [1, 2, 3].map((unit) => ({
        selector: `a6500000-0000-4000-8000-00000000000${unit}`,
        eventId: EVENT,
        eventName: "Night Market",
        startsAt: "2026-09-09T18:00:00+00:00",
        endsAt: "2026-09-09T20:00:00+00:00",
        venueName: "Venue to be announced",
        admissionLabel: "General Admission",
        position: unit,
        totalInCollection: 3,
        status: "valid",
        admissionCredential: credential(unit),
      })),
    },
  });
});

Deno.test("used history survives paid, event cancellation and full refund without raw inactive credentials", async () => {
  for (const inactive of ["used", "cancelled", "refunded"]) {
    const p = projection();
    p.tickets[0].status = "used";
    if (inactive === "cancelled") p.event_status = "cancelled";
    if (inactive === "refunded") p.order_status = "refunded";
    p.tickets[1].status = inactive;
    p.tickets[2].status = inactive;
    p.event_venue_name = "Market Hall";
    const response = await createTicketCollectionHandler(dependencies(p))(
      request(),
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(
      result.collection.tickets.map((t: { admissionCredential: null }) =>
        t.admissionCredential
      ),
      [null, null, null],
    );
    assertEquals(result.collection.tickets[0].venueName, "Market Hall");
  }
});

Deno.test("malformed, unknown and noncanonical bearers are uniformly unavailable", async () => {
  for (
    const bearer of [
      "",
      "short",
      `${BEARER}=`,
      `${BEARER.slice(0, -1)}h`,
      BEARER,
    ]
  ) {
    const response = await createTicketCollectionHandler(dependencies(null))(
      request({ collectionBearer: bearer }),
    );
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { kind: "unavailable" });
  }
});

Deno.test("projection status must be a JSON string and labels obey the persisted 80 codepoint bound", async () => {
  await unavailable({ ...projection(), order_status: ["paid"] });
  await unavailable({ ...projection(), event_status: ["published"] });
  for (const text of ["x".repeat(81), " General Admission", ""]) {
    const p = projection();
    p.items[0].admission_label = text;
    p.tickets.forEach((t) => {
      t.admission_label = text;
    });
    await unavailable(p);
  }
  const p = projection();
  p.items[0].admission_label = "🎟".repeat(80);
  p.tickets.forEach((t) => {
    t.admission_label = p.items[0].admission_label;
  });
  assertEquals(
    (await createTicketCollectionHandler(dependencies(p))(request())).status,
    200,
  );
});

Deno.test("multiple purchased tiers use source UUID and unit order with one exact collection total", async () => {
  const p = projection();
  const secondItem = "a6400000-0000-4000-8000-000000000002";
  p.items[0].quantity = 2;
  p.items.push({
    order_item_id: secondItem,
    quantity: 1,
    admission_label: "VIP",
  });
  const raw = "wta1_" +
    createHmac("sha256", SECRET).update(
      `wheretoo:paid-admission:lite:v1\n${secondItem}\n1`,
    ).digest("base64url");
  p.tickets[2] = {
    ...p.tickets[2],
    order_item_id: secondItem,
    unit_sequence: 1,
    admission_label: "VIP",
    credential_hash: createHash("sha256").update(raw).digest("hex"),
  };
  const result =
    await (await createTicketCollectionHandler(dependencies(p))(request()))
      .json();
  assertEquals(
    result.collection.tickets.map((
      t: {
        admissionLabel: string;
        position: number;
        totalInCollection: number;
        admissionCredential: string;
      },
    ) => [
      t.admissionLabel,
      t.position,
      t.totalInCollection,
      t.admissionCredential,
    ]),
    [["General Admission", 1, 3, credential(1)], [
      "General Admission",
      2,
      3,
      credential(2),
    ], ["VIP", 3, 3, raw]],
  );
});

Deno.test("ten persisted source items remain readable under the existing checkout quantity limit", async () => {
  const p = projection();
  p.quantity = 10;
  p.items = [];
  p.tickets = [];
  for (let n = 0; n < 10; n++) {
    const suffix = String(n).padStart(12, "0");
    const item = `a6400000-0000-4000-8000-${suffix}`;
    const raw = "wta1_" +
      createHmac("sha256", SECRET).update(
        `wheretoo:paid-admission:lite:v1\n${item}\n1`,
      ).digest("base64url");
    p.items.push({
      order_item_id: item,
      quantity: 1,
      admission_label: "Purchased Tier",
    });
    p.tickets.push({
      id: `a6500000-0000-4000-8000-${suffix}`,
      order_item_id: item,
      unit_sequence: 1,
      admission_label: "Purchased Tier",
      status: "valid",
      credential_hash: createHash("sha256").update(raw).digest("hex"),
    });
  }
  const response = await createTicketCollectionHandler(dependencies(p))(
    request(),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).collection.tickets.length, 10);
});

Deno.test("no partial collection escapes incorrect cardinality, source, label, lifecycle or hash", async () => {
  const mutations: Array<(p: ReturnType<typeof projection>) => void> = [
    (p) => {
      p.order_status = "checkout_open";
    },
    (p) => {
      p.order_status = "requires_review";
    },
    (p) => {
      p.order_status = "partially_refunded";
    },
    (p) => {
      p.event_status = "draft";
    },
    (p) => {
      p.tickets = [];
    },
    (p) => {
      p.tickets.pop();
    },
    (p) => {
      p.tickets.push(p.tickets[0]);
    },
    (p) => {
      p.quantity = 4;
    },
    (p) => {
      p.items[0].quantity = 2;
    },
    (p) => {
      p.items = [];
    },
    (p) => {
      p.tickets[1].unit_sequence = 1;
    },
    (p) => {
      p.tickets[1].unit_sequence = 4;
    },
    (p) => {
      p.tickets[1].id = p.tickets[0].id;
    },
    (p) => {
      p.tickets[1].order_item_id = EVENT;
    },
    (p) => {
      p.tickets[1].admission_label = "VIP";
    },
    (p) => {
      p.tickets[1].status = "cancelled";
    },
    (p) => {
      p.tickets[1].status = "refunded";
    },
    (p) => {
      p.order_status = "refunded";
    },
    (p) => {
      p.event_status = "cancelled";
    },
    (p) => {
      p.tickets.reverse();
    },
    (p) => {
      p.tickets[2].credential_hash = "00".repeat(32);
    },
    (p) => {
      p.tickets[2].credential_hash = "GG".repeat(32);
    },
    (p) => {
      p.tickets[2].credential_hash = "ab";
    },
    (p) => {
      p.event_ends_at = p.event_starts_at;
    },
  ];
  for (const mutate of mutations) {
    const p = projection();
    mutate(p);
    await unavailable(p);
  }
  await unavailable(null);
  await unavailable({
    ...projection(),
    buyer_email: "private@example.invalid",
  });
});

Deno.test("hash verification includes inactive tickets and secret errors never expose sensitive data or logs", async () => {
  const logs: unknown[][] = [];
  const original = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    for (const status of ["used", "refunded", "cancelled"]) {
      const p = projection();
      p.tickets.forEach((t) => {
        t.status = status;
      });
      if (status === "refunded") p.order_status = "refunded";
      if (status === "cancelled") p.event_status = "cancelled";
      p.tickets[2].credential_hash = "00".repeat(32);
      await unavailable(p);
    }
    await unavailable(projection(), {
      getCredentialSecret: () => {
        throw new Error(`${BEARER} ${credential(1)} ${BEARER_HASH}`);
      },
    });
    await unavailable(projection(), {
      getCredentialSecret: () => new Uint8Array(31),
    });
    await unavailable(projection(), {
      getCredentialSecret: () => new Uint8Array(32).fill(8),
    });
    await unavailable(projection(), {
      findCollection: async () => {
        throw new Error(`${BEARER} ${credential(1)} ${BEARER_HASH}`);
      },
    });
    assertEquals(logs, []);
  } finally {
    [console.log, console.warn, console.error] = original;
  }
});

Deno.test("exact origin, POST-only body and bounded streaming request apply no-store even to preflight/errors", async () => {
  const handler = createTicketCollectionHandler(dependencies());
  for (const origin of [ORIGIN, `${ORIGIN}.evil.test`, "null"]) {
    const response = await handler(
      new Request("https://functions.example/ticket-collection", {
        method: "OPTIONS",
        headers: { origin },
      }),
    );
    assertEquals(response.status, origin === ORIGIN ? 204 : 403);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      origin === ORIGIN ? ORIGIN : null,
    );
    assertEquals(response.headers.get("cache-control"), "private, no-store");
    assertEquals(response.headers.get("pragma"), "no-cache");
    if (origin === ORIGIN) {
      assertEquals(
        response.headers.get("access-control-allow-methods"),
        "POST, OPTIONS",
      );
      assertEquals(
        response.headers.get("access-control-allow-headers"),
        "authorization, content-type, x-client-info, apikey, x-whereto-confirmation-bearer",
      );
      assertEquals(response.headers.get("vary"), "Origin");
    }
  }
  assertEquals(
    (await handler(request(undefined, `${ORIGIN}.evil.test`))).status,
    403,
  );
  assertEquals(
    (await handler(
      new Request("https://functions.example/ticket-collection", {
        headers: { origin: ORIGIN },
      }),
    )).status,
    405,
  );
  for (
    const body of [
      { collectionBearer: BEARER, extra: true },
      { confirmationToken: BEARER },
      "x".repeat(513),
      null,
    ]
  ) {
    assertEquals((await handler(request(body))).status, 404);
  }
  for (const length of ["-1", "513", "nope"]) {
    const req = request();
    req.headers.set("content-length", length);
    assertEquals((await handler(req)).status, 404);
  }
  const wrongType = request();
  wrongType.headers.set("content-type", "text/plain");
  assertEquals((await handler(wrongType)).status, 404);
  for (const body of ["{bad json", new Uint8Array([255])]) {
    assertEquals(
      (await handler(
        new Request("https://functions.example/ticket-collection", {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body,
        }),
      )).status,
      404,
    );
  }
  const paddedBody = JSON.stringify({ collectionBearer: BEARER }).padEnd(
    512,
    " ",
  );
  assertEquals(
    (await handler(
      new Request("https://functions.example/ticket-collection", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: paddedBody,
      }),
    )).status,
    200,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(513));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await handler(
    new Request("https://functions.example/ticket-collection", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: stream,
    }),
  );
  assertEquals(response.status, 404);
  assertEquals(cancelled, true);
});

Deno.test("default transport calls only the service RPC with a hash and rejects ambiguous/error responses", async () => {
  const client = (data: unknown, error: unknown = null) =>
    ({
      rpc: async (name: string, args: unknown) => {
        assertEquals(name, "server_lookup_paid_ticket_collection");
        assertEquals(args, { p_confirmation_token_hash: BEARER_HASH });
        return { data, error };
      },
    }) as unknown as Parameters<typeof defaultFindCollection>[1];
  assertEquals(
    await defaultFindCollection(BEARER_HASH, client([projection()])),
    projection(),
  );
  for (const data of [[], [projection(), projection()], {}, null]) {
    assertEquals(await defaultFindCollection(BEARER_HASH, client(data)), null);
  }
  assertEquals(
    await defaultFindCollection(
      BEARER_HASH,
      client([projection()], { message: BEARER }),
    ),
    null,
  );
  assertFalse(
    JSON.stringify(await defaultFindCollection(BEARER_HASH, client(null)))
      .includes(BEARER),
  );
});

Deno.test("a canonical paid bearer beginning rsvp_ still resolves exclusively as paid", async () => {
  let paid = 0;
  let free = 0;
  const response = await createTicketCollectionHandler(
    dependencies(projection(), {
      findCollection: async () => {
        paid++;
        return projection();
      },
      findFreeCollection: async () => {
        free++;
        return null;
      },
    }),
  )(request({ collectionBearer: "rsvp_" + "A".repeat(38) }));
  assertEquals(response.status, 200);
  assertEquals(paid, 1);
  assertEquals(free, 0);
});

Deno.test("approved private facts retain paid Used timestamp while cancellation stays separate", async () => {
  const old = projection();
  const value = {
    ...old,
    event_status: "cancelled",
    event_facts_available: true,
    event_updated: true,
    event_timezone: "America/Los_Angeles",
    event_address: "1 Market St",
    tickets: old.tickets.map((t, i) => ({
      ...t,
      status: i === 0 ? "used" : "cancelled",
      used_at: i === 0 ? "2026-09-09T18:30:00Z" : null,
    })),
  };
  const response = await createTicketCollectionHandler(dependencies(value))(
    request(),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.collection.tickets[0].usedAt, "2026-09-09T18:30:00Z");
  assertEquals(body.collection.tickets[0].eventStatus, "cancelled");
  assertEquals(
    body.collection.tickets.every((t: { admissionCredential: unknown }) =>
      t.admissionCredential === null
    ),
    true,
  );
});
Deno.test("unavailable legacy event facts do not synthesize schedule or leak mutable metadata", async () => {
  const old = projection();
  const value = {
    ...old,
    event_title: null,
    event_starts_at: null,
    event_ends_at: null,
    event_venue_name: null,
    event_status: "cancelled",
    event_facts_available: false,
    event_updated: false,
    event_timezone: null,
    event_address: null,
    tickets: old.tickets.map((t) => ({
      ...t,
      status: "cancelled",
      used_at: null,
    })),
  };
  const response = await createTicketCollectionHandler(dependencies(value))(
    request(),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.collection.tickets[0].startsAt, null);
  assertEquals(body.collection.tickets[0].eventFactsAvailable, false);
  assertEquals(
    body.collection.tickets[0].eventName,
    "Event details unavailable",
  );
  await unavailable({ ...value, event_title: "Unapproved private title" });
});
