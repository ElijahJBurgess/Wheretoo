export const reservedHandles = [
  'auth',
  'discover',
  'discovery',
  'event-policy',
  'event-status',
  'events',
  'moderation',
  'orders',
  'organizer',
  'organizer-terms',
  'refund-details',
  'rsvp',
  'ticket-access',
  'tickets',
  'assets',
  'api',
  'terms',
  'privacy',
  'support',
  'help',
  'admin',
  'login',
  'signup',
  '__dev',
] as const
export function normalizeHandle(value: string) {
  return value.trim().toLowerCase()
}
export function isValidHandle(value: string) {
  return value.length >= 3 && value.length <= 30 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    !reservedHandles.some((handle) => handle === value)
}
