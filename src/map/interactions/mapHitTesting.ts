export function uniqueEventIds(features: readonly unknown[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const feature of features) {
    if (!feature || typeof feature !== 'object' || !('properties' in feature)) continue
    const properties = feature.properties
    const eventId = properties && typeof properties === 'object' && 'eventId' in properties ? properties.eventId : null
    if (typeof eventId === 'string' && !seen.has(eventId)) { seen.add(eventId); ids.push(eventId) }
  }
  return ids
}
