import type { OrderConfirmation } from '../orders/order.types'

const escapeText = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '').replaceAll(';', '\\;').replaceAll(',', '\\,')
const calendarTime = (value: string) => new Date(value).toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '')

// RFC 5545 folds at 75 octets; iterate code points so Unicode titles stay intact.
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = '', bytes = 0
  for (const character of line) {
    const size = encoder.encode(character).length
    if (bytes + size > 75) { parts.push(current); current = ' '; bytes = 1 }
    current += character
    bytes += size
  }
  return [...parts, current].join('\r\n')
}

export type AdmissionCalendarEvent = { uid:string; title:string; startsAt:string; endsAt:string; location:string }
export function createEventCalendar(order: OrderConfirmation, now = new Date()): string {
  return createAdmissionCalendar({uid:order.orderNumber,title:order.event.title,startsAt:order.event.startsAt,endsAt:order.event.endsAt,location:order.event.venueName??''},now)
}
export function createAdmissionCalendar(event: AdmissionCalendarEvent, now = new Date()): string {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wheretoo//Buyer calendar//EN', 'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}@wheretoo`, `DTSTAMP:${calendarTime(now.toISOString())}`,
    `DTSTART:${calendarTime(event.startsAt)}`, `DTEND:${calendarTime(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(foldLine).join('\r\n')
}

export function downloadEventCalendar(order: OrderConfirmation) {
  downloadCalendarContent(createEventCalendar(order))
}
export function downloadAdmissionCalendar(event: AdmissionCalendarEvent) { downloadCalendarContent(createAdmissionCalendar(event)) }
function downloadCalendarContent(content:string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'wheretoo-event.ics'
  link.click()
  // Let the browser take ownership of the download before releasing its source.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
