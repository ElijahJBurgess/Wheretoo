import { instantToLosAngelesWallTime, losAngelesWallTimeToInstant } from '../events/event.time'

/** The server resolves windows; this only schedules when that read becomes dated. */
export function nextDiscoveryMidnight(serverNow: number): number {
  const date = instantToLosAngelesWallTime(new Date(serverNow).toISOString()).slice(0, 10)
  const tomorrow = new Date(`${date}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return losAngelesWallTimeToInstant(`${tomorrow.toISOString().slice(0, 10)}T00:00`)!.getTime()
}
