const EVENT_TIME_ZONE = 'America/Los_Angeles'
const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/

const wallTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type WallTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function isRealCalendarTime(parts: WallTimeParts): boolean {
  if (
    parts.year < 1000 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59
  ) {
    return false
  }

  return parts.day <= new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()
}

function parseWallTimeParts(value: string): WallTimeParts | null {
  const match = WALL_TIME_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const parts: WallTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }
  return isRealCalendarTime(parts) ? parts : null
}

function partsForInstant(instant: Date): WallTimeParts | null {
  const parts = Object.fromEntries(
    wallTimeFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  if (
    !Number.isFinite(parts.year) ||
    !Number.isFinite(parts.month) ||
    !Number.isFinite(parts.day) ||
    !Number.isFinite(parts.hour) ||
    !Number.isFinite(parts.minute)
  ) {
    return null
  }

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  }
}

function sameWallTime(left: WallTimeParts | null, right: WallTimeParts): boolean {
  return (
    left !== null &&
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  )
}

export function losAngelesWallTimeToInstant(value: string): Date | null {
  const wallTime = parseWallTimeParts(value)
  if (wallTime === null) {
    return null
  }

  const wallAsUtc = Date.UTC(
    wallTime.year,
    wallTime.month - 1,
    wallTime.day,
    wallTime.hour,
    wallTime.minute,
  )
  const matches: Date[] = []

  // Testing every possible civil UTC offset keeps this independent of the browser's local zone.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(wallAsUtc - offsetMinutes * 60_000)
    if (sameWallTime(partsForInstant(candidate), wallTime)) {
      matches.push(candidate)
    }
  }

  // The fall-back hour maps to two instants. Whereto consistently chooses the earlier occurrence.
  return matches.length === 0
    ? null
    : matches.reduce((earliest, date) => (date < earliest ? date : earliest))
}

export function losAngelesWallTimeToIso(value: string): string | null {
  return losAngelesWallTimeToInstant(value)?.toISOString() ?? null
}

export function instantToLosAngelesWallTime(value: string): string {
  const match = INSTANT_PATTERN.exec(value)
  if (!match) {
    return ''
  }

  const instantCalendar: WallTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }
  const seconds = Number(match[6])
  const instant = new Date(value)
  if (
    !isRealCalendarTime(instantCalendar) ||
    seconds < 0 ||
    seconds > 59 ||
    !Number.isFinite(instant.getTime())
  ) {
    return ''
  }

  const parts = partsForInstant(instant)
  if (parts === null) {
    return ''
  }

  const pad = (number: number) => String(number).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}
