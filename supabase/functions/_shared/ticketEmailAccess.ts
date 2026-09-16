export type EmailPurpose =
  | "initial"
  | "resend"
  | "recovery"
  | "refund_notice"
  | "event_change"
  | "event_cancellation";
export type ProviderEmailPayload = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  tags: { name: "attempt_id"; value: string }[];
};
export type EmailPayloadContent = {
  kind: "provider";
  request: ProviderEmailPayload;
} | { kind: "recovery_request"; email: string };
export type PayloadContext = {
  kind: "provider";
  attemptId: string;
  grantId: string | null;
} | { kind: "recovery_request"; requestId: string };
export type EncryptedEmailPayload = {
  version: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
};

const encoder = new TextEncoder();
const maxPlaintextBytes = 256 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const payloadError = () => new Error("Email payload is invalid or unavailable");

function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function decode(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" || value.length > Math.ceil(maxBytes * 4 / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) throw payloadError();
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4),
  );
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    bytes.length < minBytes || bytes.length > maxBytes ||
    encode(bytes) !== value
  ) throw payloadError();
  return bytes;
}

function record(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function canonicalEmail(value: unknown): value is string {
  // Spec 06 canonical ASCII rules; deliberately preserve dots and plus aliases.
  return typeof value === "string" && value.length <= 320 &&
    value === value.trim().toLowerCase() &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
      .test(value);
}

function validateContext(value: unknown): asserts value is PayloadContext {
  if (
    record(value, ["kind", "attemptId", "grantId"]) &&
    value.kind === "provider" &&
    uuid(value.attemptId) && (value.grantId === null || uuid(value.grantId))
  ) return;
  if (
    record(value, ["kind", "requestId"]) && value.kind === "recovery_request" &&
    uuid(value.requestId)
  ) return;
  throw payloadError();
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127;
  });
}

function header(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 998 && !hasControlCharacters(value);
}

function validateContent(
  value: unknown,
  context: PayloadContext,
): asserts value is EmailPayloadContent {
  if (
    context.kind === "recovery_request" && record(value, ["kind", "email"]) &&
    value.kind === "recovery_request" && canonicalEmail(value.email)
  ) return;
  if (
    context.kind !== "provider" || !record(value, ["kind", "request"]) ||
    value.kind !== "provider"
  ) throw payloadError();
  const request = value.request;
  if (
    !record(request, [
      "from",
      "to",
      "replyTo",
      "subject",
      "html",
      "text",
      "tags",
    ]) ||
    !header(request.from) || !header(request.to) || !header(request.replyTo) ||
    !header(request.subject) ||
    typeof request.html !== "string" || request.html.length === 0 ||
    typeof request.text !== "string" || request.text.length === 0 ||
    !Array.isArray(request.tags) || request.tags.length !== 1
  ) throw payloadError();
  const tag: unknown = request.tags[0];
  if (
    !record(tag, ["name", "value"]) || tag.name !== "attempt_id" ||
    !uuid(tag.value) ||
    tag.value.toLowerCase() !== context.attemptId.toLowerCase()
  ) throw payloadError();
}

function aad(context: PayloadContext, keyId: string): Uint8Array<ArrayBuffer> {
  validateContext(context);
  if (typeof keyId !== "string" || !keyIdPattern.test(keyId)) {
    throw payloadError();
  }
  const identity = context.kind === "provider"
    ? [
      context.kind,
      context.attemptId.toLowerCase(),
      context.grantId?.toLowerCase() ?? null,
    ]
    : [context.kind, context.requestId.toLowerCase()];
  return encoder.encode(
    JSON.stringify(["wheretoo:email-payload:v1", 1, keyId, ...identity]),
  );
}

function keyBytes(key: Uint8Array): ArrayBuffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw payloadError();
  }
  return new Uint8Array(key).buffer;
}

export async function createEmailGrant(): Promise<
  { token: string; tokenHash: string }
> {
  const token = `em1_${encode(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { token, tokenHash: await hashEmailGrant(token) };
}

export async function hashEmailGrant(token: string): Promise<string> {
  try {
    if (
      typeof token !== "string" || token.length !== 47 ||
      !token.startsWith("em1_")
    ) throw new Error();
    decode(token.slice(4), 32, 32);
    return hex(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`wheretoo:email-access:v1\n${token}`),
      ),
    );
  } catch {
    throw new Error("Email access grant is invalid");
  }
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") throw new Error();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
      .exec(value);
  if (!match) throw new Error();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const result = Date.parse(value);
  if (
    month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
    hour > 23 || minute > 59 || second > 59 || !Number.isFinite(result)
  ) throw new Error();
  return result;
}

export function grantExpiresAt(
  purpose: EmailPurpose,
  preparedAt: string,
  eventEndsAt?: string,
): string {
  try {
    if (
      purpose !== "initial" && purpose !== "resend" && purpose !== "recovery" &&
      purpose !== "refund_notice" && purpose !== "event_change" &&
      purpose !== "event_cancellation"
    ) throw new Error();
    const prepared = timestamp(preparedAt);
    const basis = purpose === "recovery" || purpose === "refund_notice" ||
        purpose === "event_cancellation"
      ? prepared
      : timestamp(eventEndsAt);
    const expires = basis +
      (purpose === "refund_notice" || purpose === "event_cancellation"
          ? 30
          : 1) * 24 * 60 * 60 * 1000;
    if (expires <= prepared) throw new Error();
    // Persist this once with the prepared attempt; retries must reuse it after reschedules.
    return new Date(expires).toISOString();
  } catch {
    throw new Error("Email grant expiry is invalid");
  }
}

export async function encryptEmailPayload(
  content: EmailPayloadContent,
  context: PayloadContext,
  keyId: string,
  key: Uint8Array,
): Promise<EncryptedEmailPayload> {
  try {
    const additionalData = aad(context, keyId);
    validateContent(content, context);
    const plaintext = encoder.encode(JSON.stringify(content));
    if (plaintext.byteLength > maxPlaintextBytes) throw payloadError();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes(key),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 },
      cryptoKey,
      plaintext,
    );
    return {
      version: 1,
      keyId,
      nonce: encode(nonce),
      ciphertext: encode(new Uint8Array(encrypted)),
    };
  } catch {
    throw payloadError();
  }
}

export async function decryptEmailPayload(
  envelope: EncryptedEmailPayload,
  context: PayloadContext,
  keys: ReadonlyMap<string, Uint8Array>,
): Promise<EmailPayloadContent> {
  try {
    if (
      !record(envelope, ["version", "keyId", "nonce", "ciphertext"]) ||
      envelope.version !== 1
    ) throw payloadError();
    const additionalData = aad(context, envelope.keyId);
    const nonce = decode(envelope.nonce, 12, 12);
    const ciphertext = decode(envelope.ciphertext, 17, maxPlaintextBytes + 16);
    const key = keys.get(envelope.keyId);
    if (!key) throw payloadError();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes(key),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 },
      cryptoKey,
      ciphertext,
    );
    const content: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
    validateContent(content, context);
    return content;
  } catch {
    throw payloadError();
  }
}

export async function emailRateFingerprint(
  secret: Uint8Array,
  lane: string,
  subject: string,
): Promise<string> {
  try {
    if (
      typeof lane !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(lane) ||
      typeof subject !== "string" || subject.length === 0 ||
      encoder.encode(subject).byteLength > 1024 ||
      hasControlCharacters(subject)
    ) throw new Error();
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return hex(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(
          JSON.stringify(["wheretoo:email-rate:v1", lane, subject]),
        ),
      ),
    );
  } catch {
    throw new Error("Email rate fingerprint input is invalid");
  }
}
