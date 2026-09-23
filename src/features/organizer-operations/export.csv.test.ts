import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { exportSchema } from './export.schemas'
import { csvCell, exportFilename, serializeExport } from './export.csv'

import { event, order, payload } from '../../test/exportFixtures'
function parse(csv: string): string[][] {
  const result = spawnSync('python3', ['-c', 'import csv,io,json,sys;print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")),strict=True))))'], { input: csv, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}
it('keeps one multi-tier order, original totals and blank paid date with exact columns', () => {
  const csv = serializeExport(exportSchema.parse(payload))
  const rows = parse(csv)
  expect(rows[0]).toEqual(['Event Name','Event Status','Event Start UTC','Event End UTC','Event Timezone','Exported At UTC','Order Number','Buyer Name','Buyer Email','Order Created At UTC','Paid At UTC','Order Status','Refund Workflow State','Quantity','Ticket Items','Currency','Subtotal','Tax','Order Total'])
  expect(rows).toHaveLength(2)
  expect(rows[1]).toHaveLength(19)
  expect(rows[1][10]).toBe('')
  expect(rows[1][14]).toBe('GA × 2 @ 20.00 usd (subtotal 40.00 usd)\nVIP × 1 @ 45.00 usd (subtotal 45.00 usd)')
  expect(rows[1].slice(-3)).toEqual(['85.00','0.00','85.00'])
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv.endsWith('\r\n')).toBe(true)
})
it.each(['=1+1','+1','-1','@SUM(1)',' \t=1','\u200B=1','\nplain','\rplain','\tplain','＝1','＋1','－1','＠x'])('neutralizes hazardous text %j without losing the original', value => {
  expect(parse(`${csvCell(value)}\r\n`)[0][0]).toBe(`'${value}`)
})
it.each(['a,b','a"b','a\r\nb','a\nb','Café 🌇','', 'a",=1\nnext'])('round trips text %j using an independent parser', value => {
  expect(parse(`${csvCell(value)}\r\n`)[0][0]).toBe(value)
})
it('fails entire output on invalid controls and oversized cells', () => {
  expect(() => csvCell('x\0y')).toThrow()
  expect(() => csvCell('x\u0085y')).toThrow()
  expect(() => csvCell('x'.repeat(32768))).toThrow()
  expect(() => csvCell('='.repeat(32767))).toThrow()
  expect(csvCell('x'.repeat(32767))).toHaveLength(32769)
})
it('validates exact response keys, count, money and secret leakage rather than dropping keys', () => {
  for (const bad of [{ ...payload, rowCount: 2 }, { ...payload, secret: 'SENTINEL' }, { ...payload, rows: [{ ...order, credential_hash: 'SENTINEL' }] }, { ...payload, rows: [{ ...order, totalMinor: 99 }] }]) {
    expect(exportSchema.safeParse(bad).success).toBe(false)
  }
})
it('uses event local date, safe Unicode slug, fallback and no UUID', () => {
  expect(exportFilename(exportSchema.parse(payload))).toBe('r-b-fridays-2026-10-09-orders.csv')
  expect(exportFilename(exportSchema.parse({ ...payload, event: { ...event, title: ' 東京 / fête ', startsAt: null } }))).toBe('東京-fête-undated-orders.csv')
  expect(exportFilename(exportSchema.parse({ ...payload, event: { ...event, title: null, timezone: 'invalid' } }))).toBe('event-undated-orders.csv')
})
it('exports an empty event with headers and no invented rows', () => {
  expect(parse(serializeExport(exportSchema.parse({ ...payload, rowCount: 0, rows: [] })))).toHaveLength(1)
})
it('preserves DB-valid padded titles and Unicode codepoint-limited labels', () => {
  const title = ` ${'x'.repeat(120)} `
  const data = exportSchema.parse({ ...payload, event: { ...event, title }, rows: [{ ...order, buyerName: '😀'.repeat(120), items: order.items.map(item => ({ ...item, tierName: '😀'.repeat(80) })) }] })
  expect(parse(serializeExport(data))[1][0]).toBe(title)
})
it('renders all admission statuses and stable group positions with exact headers', () => {
  const statuses = ['valid', 'used', 'refunded', 'cancelled'] as const
  const data = exportSchema.parse({ ...payload, kind: 'admissions', rowCount: 4, rows: statuses.map((status, i) => ({ orderNumber: 'ORD-A', ticketPosition: i + 1, ticketsInOrder: 4, buyerName: 'Buyer', buyerEmail: 'buyer@example.invalid', ticketTier: 'Frozen Tier', orderStatus: 'requires_review', ticketStatus: status, issuedAt: payload.exportedAt, usedAt: status === 'used' ? payload.exportedAt : null })) })
  const rows = parse(serializeExport(data))
  expect(rows[0]).toEqual(['Event Name','Event Status','Event Start UTC','Event End UTC','Event Timezone','Exported At UTC','Order Number','Ticket Position','Tickets In Order','Buyer Name','Buyer Email','Ticket Tier','Order Status','Ticket Status','Issued At UTC','Check-In Status','Check-In Time UTC'])
  expect(rows.slice(1).map(row => row[7])).toEqual(['1','2','3','4'])
  expect(rows.slice(1).map(row => row[15])).toEqual(['not_checked_in','checked_in','not_checked_in','not_checked_in'])
  expect(rows.every(row => row.length === 17)).toBe(true)
})
it('renders group registration history without invented order or attendee fields', () => {
  const data = exportSchema.parse({ ...payload, kind: 'registrations', rowCount: 2, rows: ['used','cancelled'].map((status, i) => ({ registrationReference: `RSVP-${event.id}`, registrantName: '+Registrant', registrantEmail: 'guest@example.invalid', registeredAt: payload.exportedAt, registrationStatus: 'cancelled', registrationQuantity: 2, admissionPosition: i + 1, admissionLabel: 'General Admission', admissionStatus: status, issuedAt: payload.exportedAt, usedAt: status === 'used' ? payload.exportedAt : null })) })
  const rows = parse(serializeExport(data))
  expect(rows[0]).toEqual(['Event Name','Event Status','Event Start UTC','Event End UTC','Event Timezone','Exported At UTC','Registration Reference','Registrant Name','Registrant Email','Registered At UTC','Registration Status','Registration Quantity','Admission Position','Admission Label','Admission Status','Issued At UTC','Check-In Status','Check-In Time UTC'])
  expect(rows.slice(1).map(row => row[7])).toEqual(["'+Registrant", "'+Registrant"])
  expect(rows.every(row => row.length === 18)).toBe(true)
})
it('accepts the row cap and rejects cap+1 and a CSV above the independent byte budget', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({ ...order, orderNumber: `ORD-${i}` }))
  const data = exportSchema.parse({ ...payload, rowCount: rows.length, rows })
  expect(serializeExport(data).length).toBeLessThan(8 * 1024 * 1024)
  expect(exportSchema.safeParse({ ...data, rowCount: 10001, rows: [...rows, { ...order, orderNumber: 'extra' }] }).success).toBe(false)
  const large = exportSchema.parse({ ...data, event: { ...event, title: '😀'.repeat(120) }, rows: rows.map(row => ({ ...row, buyerName: '😀'.repeat(120) })) })
  expect(() => serializeExport(large)).toThrow('download limit')
})
