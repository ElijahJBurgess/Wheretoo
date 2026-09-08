import { type EnvReader, requireEnv } from "./env.ts";

export type PaidAdmissionSource = {
  orderItemId: string;
  unitSequence: number;
};

const textEncoder = new TextEncoder();
const secretName = "TICKET_CREDENTIAL_SECRET";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("Ticket credential secret is invalid");
  }

  let binary: string;
  try {
    binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + "=",
    );
  } catch {
    throw new Error("Ticket credential secret is invalid");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 32 || encodeBase64Url(bytes) !== value) {
    throw new Error("Ticket credential secret is invalid");
  }
  return bytes;
}

export function getTicketCredentialSecret(read?: EnvReader): Uint8Array {
  let encoded: string;
  try {
    encoded = requireEnv(secretName, read);
  } catch {
    throw new Error("Ticket credential secret is missing or invalid");
  }
  return decodeBase64Url(encoded);
}

export async function derivePaidAdmissionCredential(
  secret: Uint8Array,
  source: PaidAdmissionSource,
): Promise<string> {
  if (secret.length !== 32) {
    throw new Error("Ticket credential secret is invalid");
  }
  if (!uuidPattern.test(source.orderItemId)) {
    throw new Error("Paid admission source is invalid");
  }
  if (
    !Number.isInteger(source.unitSequence) || source.unitSequence < 1 ||
    source.unitSequence > 10
  ) {
    throw new Error("Paid admission source is invalid");
  }

  const keyBytes = new ArrayBuffer(secret.byteLength);
  new Uint8Array(keyBytes).set(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const canonical =
    `wheretoo:paid-admission:lite:v1\n${source.orderItemId.toLowerCase()}\n${source.unitSequence}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(canonical)),
  );
  return `wta1_${encodeBase64Url(signature)}`;
}

export async function hashAdmissionCredential(
  credential: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", textEncoder.encode(credential)),
  );
}
