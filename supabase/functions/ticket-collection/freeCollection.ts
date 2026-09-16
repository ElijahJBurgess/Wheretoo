import type {
  TicketCollection,
  TicketDisplay,
} from "../../../src/features/ticket-experience/contracts/ticketCollection.ts";
import {
  deriveFreeAdmissionCredential,
  hex,
  isRecord,
  UUID_PATTERN,
} from "../_shared/freeRegistration.ts";
import { hashAdmissionCredential } from "../_shared/ticketCredentials.ts";
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const label = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim() === v && [...v].length >= 1 &&
  [...v].length <= max;
function timezone(v: unknown): v is string {
  if (!label(v, 100)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}
export async function freeCollectionFromProjection(
  value: unknown,
  getSecret: () => Uint8Array,
): Promise<TicketCollection | null> {
  const extended = isRecord(value) &&
    Object.hasOwn(value, "event_facts_available");
  const factsAvailable = !extended ||
    (isRecord(value) && value.event_facts_available === true);
  if (
    !isRecord(value) ||
    !["registration_id", "request_id", "event_id", "organizer_id"].every((k) =>
      typeof value[k] === "string" && UUID_PATTERN.test(value[k] as string)
    ) ||
    (value.registration_status !== "confirmed" &&
      value.registration_status !== "cancelled") ||
    (value.event_status !== "published" &&
      value.event_status !== "cancelled") ||
    (value.registration_status === "cancelled") !==
      (value.event_status === "cancelled") ||
    typeof value.quantity !== "number" || !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    value.quantity > 10 ||
    !label(value.name, 200) ||
    (extended &&
      (typeof value.event_facts_available !== "boolean" ||
        typeof value.event_updated !== "boolean")) ||
    (factsAvailable
      ? !label(value.event_title, 120) || !timestamp(value.event_starts_at) ||
        !timestamp(value.event_ends_at) ||
        Date.parse(value.event_ends_at) <= Date.parse(value.event_starts_at) ||
        !timezone(value.event_timezone)
      : [
        value.event_title,
        value.event_starts_at,
        value.event_ends_at,
        value.event_venue_name,
        value.event_timezone,
        value.event_address,
      ].some((v) => v !== null)) ||
    (value.event_venue_name !== null && !label(value.event_venue_name, 160)) ||
    !Array.isArray(value.tickets) || value.tickets.length !== value.quantity
  ) return null;
  const tickets: TicketDisplay[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const secret = getSecret();
  let mismatch = 0;
  for (const [index, t] of value.tickets.entries()) {
    if (
      !isRecord(t) || typeof t.id !== "string" || !UUID_PATTERN.test(t.id) ||
      ids.has(t.id) ||
      t.unit_sequence !== index + 1 ||
      !label(t.admission_label, 80) || typeof t.credential_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(t.credential_hash) ||
      hashes.has(t.credential_hash) ||
      (t.status !== "used" &&
        t.status !==
          (value.registration_status === "cancelled"
            ? "cancelled"
            : "valid")) ||
      (t.status === "used" ? !timestamp(t.used_at) : t.used_at !== null)
    ) return null;
    ids.add(t.id);
    hashes.add(t.credential_hash);
    const credential = await deriveFreeAdmissionCredential(
      secret,
      value.request_id as string,
      index + 1,
    );
    const derived = hex(await hashAdmissionCredential(credential));
    for (let i = 0; i < 64; i++) {
      mismatch |= derived.charCodeAt(i) ^ t.credential_hash.charCodeAt(i);
    }
    tickets.push({
      selector: t.id,
      eventId: value.event_id as string,
      eventName: factsAvailable
        ? value.event_title as string
        : "Event details unavailable",
      startsAt: factsAvailable ? value.event_starts_at as string : null,
      endsAt: factsAvailable ? value.event_ends_at as string : null,
      venueName: factsAvailable
        ? value.event_venue_name as string | null ?? "Venue to be announced"
        : "Venue unavailable",
      ...(extended
        ? {
          eventFactsAvailable: factsAvailable,
          eventUpdated: value.event_updated as boolean,
          eventStatus: value.event_status,
        }
        : {}),
      admissionLabel: t.admission_label,
      position: index + 1,
      totalInCollection: value.quantity,
      attendeeLabel: value.name,
      ...(factsAvailable ? { timezone: value.event_timezone as string } : {}),
      ...(t.status === "used" ? { usedAt: t.used_at as string } : {}),
      ...(t.status === "valid"
        ? { status: "valid" as const, admissionCredential: credential }
        : {
          status: t.status as "used" | "cancelled",
          admissionCredential: null,
        }),
      ...(typeof value.event_address === "string" && value.event_address
        ? {
          directionsUrl: "https://www.google.com/maps/search/?api=1&query=" +
            encodeURIComponent(value.event_address),
        }
        : {}),
    });
  }
  return mismatch === 0
    ? {
      registrationId: value.registration_id as string,
      registrationStatus: value.registration_status,
      collectionLabel: `${
        factsAvailable ? value.event_title : "Event"
      } tickets`,
      eventId: value.event_id as string,
      tickets,
    }
    : null;
}
