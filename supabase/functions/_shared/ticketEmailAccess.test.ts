import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  createEmailGrant,
  decryptEmailPayload,
  type EmailPayloadContent,
  emailRateFingerprint,
  type EncryptedEmailPayload,
  encryptEmailPayload,
  grantExpiresAt,
  hashEmailGrant,
  type PayloadContext,
} from "./ticketEmailAccess.ts";

const attemptId = "550e8400-e29b-41d4-a716-446655440000";
const grantId = "550e8400-e29b-41d4-a716-446655440001";
const otherId = "550e8400-e29b-41d4-a716-446655440002";
const key = new Uint8Array(32).fill(7);
const context: PayloadContext = { kind: "provider", attemptId, grantId };
const recoveryContext: PayloadContext = {
  kind: "recovery_request",
  requestId: otherId,
};
const keys = new Map([["current", key]]);
const provider: EmailPayloadContent = {
  kind: "provider",
  request: {
    from: "Wheretoo <tickets@example.invalid>",
    to: "alex+ticket@example.invalid",
    replyTo: "support@example.invalid",
    subject: "Your tickets are here",
    html: "<p>Private link: em1_" + "A".repeat(43) + "</p>",
    text: "Private link: em1_" + "A".repeat(43),
    tags: [{ name: "attempt_id", value: attemptId }],
  },
};

Deno.test("email grants are random canonical 32-byte bearers with independent hashes", async () => {
  const grants = await Promise.all(
    Array.from({ length: 100 }, () => createEmailGrant()),
  );
  assertEquals(new Set(grants.map((grant) => grant.token)).size, 100);
  assertEquals(new Set(grants.map((grant) => grant.tokenHash)).size, 100);
  for (const grant of grants) {
    assertMatch(grant.token, /^em1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
    assertMatch(grant.tokenHash, /^[0-9a-f]{64}$/);
    assertEquals(grant.tokenHash, await hashEmailGrant(grant.token));
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      "wheretoo:email-access:v1\nem1_" + "A".repeat(43),
    ),
  );
  assertEquals(
    await hashEmailGrant("em1_" + "A".repeat(43)),
    Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join(""),
  );
});

Deno.test("email grants reject old paid/free/admission prefixes and noncanonical encodings", async () => {
  for (
    const token of [
      "A".repeat(43),
      "rsvp_" + "A".repeat(43),
      "wta1_" + "A".repeat(43),
      "em1_" + "A".repeat(42) + "B",
      "em1_" + "A".repeat(43) + "=",
      "em1_" + "A".repeat(42),
      " em1_" + "A".repeat(43),
      "em1_+" + "A".repeat(42),
    ]
  ) {
    await assertRejects(() => hashEmailGrant(token));
  }
});

Deno.test("initial and resend grants last through scheduled end plus 24 hours without a cap", () => {
  for (const purpose of ["initial", "resend"] as const) {
    assertEquals(
      grantExpiresAt(purpose, "2026-09-01T12:00:00Z", "2026-10-31T12:00:00Z"),
      "2026-11-01T12:00:00.000Z",
    );
  }
});

Deno.test("recovery expiry is exactly 24 hours after preparation", () => {
  assertEquals(
    grantExpiresAt("recovery", "2026-11-01T01:00:00-07:00"),
    "2026-11-02T08:00:00.000Z",
  );
  assertEquals(
    grantExpiresAt("recovery", "2026-09-01T12:00:00Z", "2026-12-01T12:00:00Z"),
    "2026-09-02T12:00:00.000Z",
  );
});

Deno.test("expiry rejects malformed, timezone-free, impossible and nonfuture dates", () => {
  for (
    const value of [
      "bad",
      "",
      "2026-02-30T12:00:00Z",
      "2026-09-01",
      "2026-09-01T12:00:00",
    ]
  ) {
    assertThrows(() => grantExpiresAt("recovery", value));
    assertThrows(() =>
      grantExpiresAt("initial", "2026-09-01T12:00:00Z", value)
    );
  }
  assertThrows(() => grantExpiresAt("initial", "2026-09-01T12:00:00Z"));
  assertThrows(() =>
    grantExpiresAt("resend", "2026-09-01T12:00:00Z", "2026-08-31T12:00:00Z")
  );
});

Deno.test("provider payload roundtrip freezes full request and attempt tag with fresh nonces", async () => {
  const input = structuredClone(provider);
  const first = await encryptEmailPayload(input, context, "current", key);
  const second = await encryptEmailPayload(input, context, "current", key);
  assertNotEquals(first.nonce, second.nonce);
  assertNotEquals(first.ciphertext, second.ciphertext);
  assertMatch(first.nonce, /^[A-Za-z0-9_-]{16}$/);
  if (input.kind === "provider") {
    input.request.text = "changed after preparation";
  }
  assertEquals(await decryptEmailPayload(first, context, keys), provider);
  assertEquals(
    await decryptEmailPayload(
      second,
      { grantId, attemptId, kind: "provider" },
      keys,
    ),
    provider,
  );
});

Deno.test("recovery payload retains canonical email and can use a previous decryption key", async () => {
  const payload: EmailPayloadContent = {
    kind: "recovery_request",
    email: "alex+ticket@example.invalid",
  };
  const envelope = await encryptEmailPayload(
    payload,
    recoveryContext,
    "previous",
    key,
  );
  assertEquals(
    await decryptEmailPayload(
      envelope,
      recoveryContext,
      new Map([["current", new Uint8Array(32).fill(9)], ["previous", key]]),
    ),
    payload,
  );
  const noGrant = { ...context, grantId: null } as PayloadContext;
  assertEquals(
    await decryptEmailPayload(
      await encryptEmailPayload(provider, noGrant, "current", key),
      noGrant,
      keys,
    ),
    provider,
  );
});

Deno.test("authentication rejects altered ciphertext, nonce, key id, key and every context field", async () => {
  const envelope = await encryptEmailPayload(provider, context, "current", key);
  const flip = (value: string) =>
    (value[0] === "A" ? "B" : "A") + value.slice(1);
  for (
    const patch of [
      { ciphertext: flip(envelope.ciphertext) },
      { nonce: flip(envelope.nonce) },
      { keyId: "alias" },
      { version: 2 },
    ]
  ) {
    await assertRejects(() =>
      decryptEmailPayload(
        { ...envelope, ...patch } as EncryptedEmailPayload,
        context,
        new Map([...keys, ["alias", key]]),
      )
    );
  }
  await assertRejects(() =>
    decryptEmailPayload(
      envelope,
      context,
      new Map([["current", new Uint8Array(32).fill(8)]]),
    )
  );
  await assertRejects(() => decryptEmailPayload(envelope, context, new Map()));
  for (
    const wrong of [
      { kind: "provider", attemptId: otherId, grantId },
      { kind: "provider", attemptId, grantId: otherId },
      { kind: "provider", attemptId, grantId: null },
      recoveryContext,
    ] as PayloadContext[]
  ) {
    await assertRejects(() => decryptEmailPayload(envelope, wrong, keys));
  }
});

Deno.test("payloads reject mismatched kinds, malformed IDs, unknown fields and incorrect attempt tags", async () => {
  await assertRejects(() =>
    encryptEmailPayload(provider, recoveryContext, "current", key)
  );
  const invalid = [
    { ...provider, extra: true },
    { kind: "provider", request: {} },
    ...[
      [],
      [{ name: "attempt_id", value: otherId }],
      [{ name: "attempt_id", value: "bad" }],
      [{ name: "other", value: attemptId }],
      [{ name: "attempt_id", value: attemptId }, {
        name: "attempt_id",
        value: attemptId,
      }],
    ]
      .map((tags) => ({
        kind: "provider",
        request: { ...provider.request, tags },
      })),
    {
      kind: "provider",
      request: { ...provider.request, to: ["alex@example.invalid"] },
    },
    {
      kind: "provider",
      request: {
        ...provider.request,
        subject: "Subject\nBcc: private@example.invalid",
      },
    },
  ];
  for (const value of invalid) {
    await assertRejects(() =>
      encryptEmailPayload(value as EmailPayloadContent, context, "current", key)
    );
  }
  for (
    const invalidContext of [
      { ...context, attemptId: "bad" },
      { ...context, grantId: "bad" },
      { ...context, extra: true },
      { kind: "recovery_request", requestId: "bad" },
    ]
  ) {
    await assertRejects(() =>
      encryptEmailPayload(
        provider,
        invalidContext as PayloadContext,
        "current",
        key,
      )
    );
  }
});

Deno.test("recovery rejects noncanonical and non-ASCII emails without alias folding", async () => {
  for (
    const email of [
      "Alex@example.invalid",
      " alex@example.invalid",
      "alex@localhost",
      "ä@example.invalid",
      "alex@example.invalid\n",
      "alex@-example.invalid",
      "a".repeat(310) + "@example.invalid",
    ]
  ) {
    await assertRejects(() =>
      encryptEmailPayload(
        { kind: "recovery_request", email },
        recoveryContext,
        "current",
        key,
      )
    );
  }
});

Deno.test("envelopes enforce canonical encoding, exact fields, key length and byte limits", async () => {
  const envelope = await encryptEmailPayload(provider, context, "current", key);
  for (
    const patch of [
      { nonce: envelope.nonce + "=" },
      { ciphertext: envelope.ciphertext + "=" },
      { nonce: "A".repeat(15) },
      { ciphertext: "A".repeat(400000) },
      { ciphertext: "A" },
      { extra: true },
    ]
  ) {
    await assertRejects(() =>
      decryptEmailPayload({ ...envelope, ...patch }, context, keys)
    );
  }
  for (
    const invalidKey of [
      new Uint8Array(16),
      new Uint8Array(31),
      new Uint8Array(33),
    ]
  ) {
    await assertRejects(() =>
      encryptEmailPayload(provider, context, "current", invalidKey)
    );
    await assertRejects(() =>
      decryptEmailPayload(envelope, context, new Map([["current", invalidKey]]))
    );
  }
  for (
    const keyId of ["", "a".repeat(129), "current\nprivate@example.invalid"]
  ) {
    await assertRejects(() =>
      encryptEmailPayload(provider, context, keyId, key)
    );
  }
  for (const text of ["a".repeat(256 * 1024), "😀".repeat(70000)]) {
    await assertRejects(() =>
      encryptEmailPayload(
        { kind: "provider", request: { ...provider.request, text } },
        context,
        "current",
        key,
      )
    );
  }
});

Deno.test("fingerprints are stable and separated by secret, lane and subject", async () => {
  const first = await emailRateFingerprint(
    key,
    "recipient",
    "alex@example.invalid",
  );
  assertMatch(first, /^[a-f0-9]{64}$/);
  assertEquals(
    first,
    await emailRateFingerprint(key, "recipient", "alex@example.invalid"),
  );
  assertNotEquals(
    first,
    await emailRateFingerprint(key, "ip", "alex@example.invalid"),
  );
  assertNotEquals(
    first,
    await emailRateFingerprint(key, "recipient", "other@example.invalid"),
  );
  assertNotEquals(
    first,
    await emailRateFingerprint(
      new Uint8Array(32).fill(9),
      "recipient",
      "alex@example.invalid",
    ),
  );
  for (
    const [lane, subject] of [["", "x"], ["a".repeat(65), "x"], ["a\nb", "x"], [
      "ip",
      "",
    ], ["ip", "a".repeat(1025)]]
  ) {
    await assertRejects(() => emailRateFingerprint(key, lane, subject));
  }
  await assertRejects(() =>
    emailRateFingerprint(new Uint8Array(16), "ip", "x")
  );
});

Deno.test("validation and authentication errors do not disclose payload or input values", async () => {
  const marker = "private-person@example.invalid";
  const envelope = await encryptEmailPayload(provider, context, "current", key);
  const operations = [
    () => hashEmailGrant(marker),
    () =>
      encryptEmailPayload(
        { kind: "recovery_request", email: marker + "\n" },
        recoveryContext,
        "current",
        key,
      ),
    () =>
      decryptEmailPayload({ ...envelope, ciphertext: marker }, context, keys),
    () => emailRateFingerprint(key, marker + "\n", marker),
  ];
  for (const operation of operations) {
    const error = await assertRejects(operation);
    assertEquals(String(error).includes(marker), false);
    assertEquals(String(error).includes(provider.request.text), false);
  }
});

// Encrypt malformed plaintext independently to exercise the post-authentication boundary.
async function authenticatedFixture(
  plaintext: Uint8Array,
): Promise<EncryptedEmailPayload> {
  const nonce = new Uint8Array(12).fill(3);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key).buffer,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const aad = new TextEncoder().encode(JSON.stringify([
    "wheretoo:email-payload:v1",
    1,
    "current",
    "provider",
    attemptId,
    grantId,
  ]));
  const bytes = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      cryptoKey,
      new Uint8Array(plaintext).buffer,
    ),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    version: 1,
    keyId: "current",
    nonce: "AwMDAwMDAwMDAwMD",
    ciphertext: btoa(binary).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", ""),
  };
}

Deno.test("authenticated plaintext still rejects wrong tags, unknown fields, invalid UTF-8 and JSON", async () => {
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  for (
    const plaintext of [
      encode({
        kind: "provider",
        request: {
          ...provider.request,
          tags: [{ name: "attempt_id", value: otherId }],
        },
      }),
      encode({ ...provider, extra: true }),
      encode({
        kind: "provider",
        request: {
          ...provider.request,
          tags: [{ name: "attempt_id", value: attemptId, extra: true }],
        },
      }),
      encode({ kind: "recovery_request", email: "alex@example.invalid" }),
      encode({ kind: "provider", request: { ...provider.request, text: 123 } }),
      encode(null),
      new Uint8Array([255]),
      new TextEncoder().encode("not json"),
    ]
  ) {
    const fixture = await authenticatedFixture(plaintext);
    const error = await assertRejects(() =>
      decryptEmailPayload(fixture, context, keys)
    );
    assertEquals(String(error).includes("alex@example.invalid"), false);
    assertEquals(String(error).includes(otherId), false);
  }
  // The independent fixture must also decrypt valid content; otherwise it only tests bad AAD.
  assertEquals(
    await decryptEmailPayload(
      await authenticatedFixture(encode(provider)),
      context,
      keys,
    ),
    provider,
  );
});

Deno.test("plaintext limit counts UTF-8 bytes and admits exactly 256 KiB", async () => {
  const empty = {
    kind: "provider" as const,
    request: { ...provider.request, text: "" },
  };
  const overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
  const boundary = {
    ...empty,
    request: { ...empty.request, text: "x".repeat(256 * 1024 - overhead) },
  };
  const envelope = await encryptEmailPayload(boundary, context, "current", key);
  assertEquals(await decryptEmailPayload(envelope, context, keys), boundary);
  await assertRejects(() =>
    encryptEmailPayload(
      {
        ...boundary,
        request: { ...boundary.request, text: boundary.request.text + "x" },
      },
      context,
      "current",
      key,
    )
  );
});
