import { EXPORT_MAX_BYTES, type EventExport, type ExportKind } from './export.schemas'

export class ExportError extends Error {
  constructor(readonly kind: 'limit' | 'format' | 'unavailable' | 'denied') {
    super(kind === 'limit' ? 'This export exceeds the current download limit. No file was downloaded.'
      : kind === 'format' ? 'The complete export could not be formatted safely. No file was downloaded.'
      : kind === 'denied' ? 'Export unavailable. Check your organizer access.'
      : 'The complete export could not be prepared. Try again.')
  }
}
const common = ['Event Name', 'Event Status', 'Event Start UTC', 'Event End UTC', 'Event Timezone', 'Exported At UTC']
export const exportHeaders: Record<ExportKind, readonly string[]> = {
  orders: [...common, 'Order Number', 'Buyer Name', 'Buyer Email', 'Order Created At UTC', 'Paid At UTC', 'Order Status', 'Refund Workflow State', 'Quantity', 'Ticket Items', 'Currency', 'Subtotal', 'Tax', 'Order Total'],
  admissions: [...common, 'Order Number', 'Ticket Position', 'Tickets In Order', 'Buyer Name', 'Buyer Email', 'Ticket Tier', 'Order Status', 'Ticket Status', 'Issued At UTC', 'Check-In Status', 'Check-In Time UTC'],
  registrations: [...common, 'Registration Reference', 'Registrant Name', 'Registrant Email', 'Registered At UTC', 'Registration Status', 'Registration Quantity', 'Admission Position', 'Admission Label', 'Admission Status', 'Issued At UTC', 'Check-In Status', 'Check-In Time UTC'],
}
export function csvCell(value: string | number | null): string {
  const original = value === null ? '' : String(value)
  // Detect through invisible prefixes without altering customer content.
  const hazardous = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(original) || /^[\t\r\n]/u.test(original)
  const safe = hazardous ? `'${original}` : original
  // Reject forbidden control bytes; this expression deliberately names controls.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(safe) || safe.length > 32767) throw new ExportError('format')
  return `"${safe.replaceAll('"', '""')}"`
}
const utc = (value: string | null) => value === null ? '' : new Date(value).toISOString()
// Integer formatting avoids rounding an immutable minor-unit snapshot.
const decimal = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
export function serializeExport(data: EventExport): string {
  const prefix = [data.event.title, data.event.status, utc(data.event.startsAt), utc(data.event.endsAt), data.event.timezone, utc(data.exportedAt)]
  const records: string[] = []
  const encoder = new TextEncoder()
  let size = 3 // UTF-8 BOM
  const append = (cells: (string | number | null)[]) => {
    const record = cells.map(csvCell).join(',') + '\r\n'
    size += encoder.encode(record).byteLength
    if (size > EXPORT_MAX_BYTES) throw new ExportError('limit')
    records.push(record)
  }
  append([...exportHeaders[data.kind]])
  if (data.kind === 'orders') for (const row of data.rows) append([...prefix,
    row.orderNumber, row.buyerName, row.buyerEmail, utc(row.createdAt), utc(row.paidAt), row.status, row.refundWorkflowState, row.quantity,
    row.items.map(item => `${item.tierName} × ${item.quantity} @ ${decimal(item.unitAmountMinor)} ${item.currency} (subtotal ${decimal(item.subtotalMinor)} ${item.currency})`).join('\n'),
    row.currency, decimal(row.subtotalMinor), decimal(row.taxMinor), decimal(row.totalMinor),
  ])
  if (data.kind === 'admissions') for (const row of data.rows) append([...prefix,
    row.orderNumber, row.ticketPosition, row.ticketsInOrder, row.buyerName, row.buyerEmail, row.ticketTier,
    row.orderStatus, row.ticketStatus, utc(row.issuedAt), row.usedAt ? 'checked_in' : 'not_checked_in', utc(row.usedAt),
  ])
  if (data.kind === 'registrations') for (const row of data.rows) append([...prefix,
    row.registrationReference, row.registrantName, row.registrantEmail, utc(row.registeredAt), row.registrationStatus,
    row.registrationQuantity, row.admissionPosition, row.admissionLabel, row.admissionStatus, utc(row.issuedAt), row.usedAt ? 'checked_in' : 'not_checked_in', utc(row.usedAt),
  ])
  return '\uFEFF' + records.join('')
}
export function exportFilename(data: EventExport): string {
  const normalized = (data.event.title ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '')
  const slug = [...normalized].slice(0, 80).join('').replace(/-+$/u, '') || 'event'
  let date = 'undated'
  try {
    if (data.event.startsAt) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: data.event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(data.event.startsAt))
      date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
    }
  } catch { /* Missing/invalid event time has a documented filename fallback. */ }
  return `${slug}-${date}-${data.kind}.csv`
}
export function downloadExport(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  try {
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Let the browser consume the URL before retiring it; no retained PII cache.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
