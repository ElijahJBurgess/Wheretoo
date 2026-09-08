export type EventDashboard = {
  eventId: string
  eventName: string
  eventStatus: string
  startsAt: string
  ticketUnitsSold: number
  checkedIn: number
  remaining: number
  grossSales: { amountMinor: number; currency: string }
  dataDisclosure: 'Demo data' | null
  manageEventPath: string
}

export type EventDashboardResult =
  | { kind: 'ready'; dashboard: EventDashboard }
  | { kind: 'unavailable' }
  | { kind: 'not_enabled' }

export interface EventDashboardReader {
  readDashboard(input: { eventId: string; signal?: AbortSignal }): Promise<EventDashboardResult>
}
