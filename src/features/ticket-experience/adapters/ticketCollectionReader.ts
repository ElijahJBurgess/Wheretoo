import { z } from 'zod'
import { publicEnv } from '../../../lib/env'
import type { TicketCollectionReader } from '../contracts/ticketCollection'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const label = (max: number) => z.string().refine((value) => value.trim() === value && [...value].length >= 1 && [...value].length <= max)
const timestamp = z.iso.datetime({ offset: true })
const credential = z.string().regex(/^wta1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
const bearer = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
const count = z.number().int().min(1).max(10)
const fields = {
  selector: uuid, eventId: uuid, eventName: label(120), startsAt: timestamp, endsAt: timestamp,
  venueName: label(160), admissionLabel: label(80), position: count, totalInCollection: count,
}
const ticket = z.discriminatedUnion('status', [
  z.strictObject({ ...fields, status: z.literal('valid'), admissionCredential: credential }),
  z.strictObject({ ...fields, status: z.enum(['used', 'refunded', 'cancelled']), admissionCredential: z.null() }),
])
const collection = z.strictObject({
  collectionLabel: label(128), eventId: uuid, tickets: z.array(ticket).min(1).max(10),
}).superRefine((value, context) => {
  const selectors = new Set<string>()
  const credentials = new Set<string>()
  const first = value.tickets[0]!
  for (const [index, item] of value.tickets.entries()) {
    if (
      item.eventId !== value.eventId || selectors.has(item.selector)
      || item.position !== index + 1 || item.totalInCollection !== value.tickets.length
      || Date.parse(item.endsAt) <= Date.parse(item.startsAt)
      || item.eventName !== first.eventName || item.startsAt !== first.startsAt
      || item.endsAt !== first.endsAt || item.venueName !== first.venueName
      || (item.admissionCredential !== null && credentials.has(item.admissionCredential))
    ) context.addIssue({ code: 'custom', message: 'Invalid collection' })
    selectors.add(item.selector)
    if (item.admissionCredential !== null) credentials.add(item.admissionCredential)
  }
})
const responseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready'), collection }),
  z.strictObject({ kind: z.literal('empty'), eventId: uuid }),
  z.strictObject({ kind: z.literal('unavailable') }),
  z.strictObject({ kind: z.literal('not_enabled') }),
])

type CollectionTransport = {
  supabaseUrl: string
  supabasePublishableKey: string
  fetch: typeof globalThis.fetch
}

export function createTicketCollectionReader(
  transport: CollectionTransport = { ...publicEnv, fetch: (...args) => globalThis.fetch(...args) },
): TicketCollectionReader {
  return {
    async readCollection({ collectionBearer, signal }) {
      signal?.throwIfAborted()
      if (!bearer.safeParse(collectionBearer).success) return { kind: 'unavailable' }
      try {
        // This public Edge boundary deliberately never constructs an Auth client.
        const response = await transport.fetch(transport.supabaseUrl + '/functions/v1/ticket-collection', {
          method: 'POST',
          headers: { apikey: transport.supabasePublishableKey, 'content-type': 'application/json' },
          body: JSON.stringify({ collectionBearer }),
          signal,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        })
        if (!response.ok) return { kind: 'unavailable' }
        const parsed = responseSchema.safeParse(await response.json())
        // Zod constructs a fresh allowlisted DTO; no provider object reaches the shell.
        return parsed.success ? parsed.data : { kind: 'unavailable' }
      } catch {
        signal?.throwIfAborted()
        return { kind: 'unavailable' }
      }
    },
  }
}
