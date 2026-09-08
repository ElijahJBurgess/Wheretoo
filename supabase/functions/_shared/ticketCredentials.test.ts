import {
  assertEquals,
  assertMatch,
  assertNotStrictEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  derivePaidAdmissionCredential,
  getTicketCredentialSecret,
  hashAdmissionCredential,
} from "./ticketCredentials.ts";

const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const ORDER_ITEM_ID = "550e8400-e29b-41d4-a716-446655440000";
const CREDENTIAL = "wta1_5wEtCue6Xy3LmjJu0SB5HRVUm-YyaO0KU9a2RUCHEwY";

Deno.test("paid admission derivation matches the fixed credential and hash vectors", async () => {
  const secret = getTicketCredentialSecret((name) =>
    name === "TICKET_CREDENTIAL_SECRET" ? SECRET : undefined
  );
  const credential = await derivePaidAdmissionCredential(secret, {
    orderItemId: ORDER_ITEM_ID,
    unitSequence: 1,
  });

  assertEquals(credential, CREDENTIAL);
  assertEquals(
    Array.from(
      await hashAdmissionCredential(credential),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join(""),
    "f4f5b59b346df1d62b9aa6fa0f8d9af4c7d7ca013cecc391567cb25d31a4d7ea",
  );
});

Deno.test("paid admission credentials are canonical and separated by unit", async () => {
  const secret = getTicketCredentialSecret(() => SECRET);
  const first = await derivePaidAdmissionCredential(secret, {
    orderItemId: ORDER_ITEM_ID.toUpperCase(),
    unitSequence: 1,
  });
  const second = await derivePaidAdmissionCredential(secret, {
    orderItemId: ORDER_ITEM_ID,
    unitSequence: 2,
  });

  assertEquals(first, CREDENTIAL);
  assertMatch(first, /^wta1_[A-Za-z0-9_-]{43}$/);
  assertEquals(first.length, 48);
  assertEquals(first === second, false);
});

Deno.test("paid admission source rejects malformed UUIDs and sequences", async () => {
  const secret = getTicketCredentialSecret(() => SECRET);
  const invalidIds = [
    "550e8400e29b41d4a716446655440000",
    "{550e8400-e29b-41d4-a716-446655440000}",
    "550e8400-e29b-41d4-a716-44665544000g",
    ` ${ORDER_ITEM_ID}`,
  ];
  for (const orderItemId of invalidIds) {
    await assertRejects(() =>
      derivePaidAdmissionCredential(secret, { orderItemId, unitSequence: 1 })
    );
  }

  for (
    const unitSequence of [0, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY]
  ) {
    await assertRejects(() =>
      derivePaidAdmissionCredential(secret, {
        orderItemId: ORDER_ITEM_ID,
        unitSequence,
      })
    );
  }
});

Deno.test("ticket credential secret rejects missing and malformed configuration without leaks", () => {
  const malformed = [
    undefined,
    "",
    `${SECRET}=`,
    `+${SECRET.slice(1)}`,
    SECRET.slice(0, -1),
    `${SECRET.slice(0, -1)}9`,
  ];

  for (const value of malformed) {
    let error: unknown;
    try {
      getTicketCredentialSecret(() => value);
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof Error, true);
    if (value) assertEquals(String(error).includes(value), false);
  }
});

Deno.test("ticket credential secret reads return independent byte arrays", () => {
  const read = () => SECRET;
  const first = getTicketCredentialSecret(read);
  const second = getTicketCredentialSecret(read);

  assertNotStrictEquals(first, second);
  assertEquals(first, second);
  first[0] = 255;
  assertEquals(second[0], 0);
  assertThrows(() => getTicketCredentialSecret(() => ` ${SECRET}`));
});
