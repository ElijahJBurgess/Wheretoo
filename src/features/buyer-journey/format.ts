export function formatBuyerMoney(minor: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100)
}

export function formatBuyerSchedule(startsAt: string, endsAt: string, timezone = 'America/Los_Angeles') {
  const start = new Date(startsAt), end = new Date(endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 'Schedule unavailable'
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' })
    const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(end).find(part => part.type === 'timeZoneName')?.value ?? ''
    return `${date.format(start)} · ${time.format(start)}–${date.format(start) !== date.format(end) ? `${date.format(end)} · ` : ''}${time.format(end)} ${zone}`
  } catch { return 'Schedule unavailable' }
}
