import { formatBuyerMoney, formatBuyerSchedule } from '../buyer-journey/format'
import type { EventCategory } from '../events/event.types'
import type { DiscoveryDisplayItem } from './discovery.types'

export const discoveryCategoryLabels: Readonly<Record<EventCategory, string>> = {
  food_drink: 'Food & Drink',
  music: 'Music',
  fitness: 'Fitness',
  art_culture: 'Art & Culture',
  shopping: 'Shopping',
  community: 'Community',
  nightlife: 'Nightlife',
  other: 'Other',
}

export function categoryLabel(category: EventCategory): string {
  return discoveryCategoryLabels[category]
}

export function discoveryAdmissionLabel(item: DiscoveryDisplayItem): string {
  if (item.admission.state === 'full') return 'Full'
  if (item.admission.state === 'sales_closed') return 'Sales closed'
  if (item.admission.state === 'not_yet_on_sale') return 'Not yet on sale'
  if (item.admissionType === 'free') return item.admission.state === 'open' ? 'Free RSVP' : 'Free'
  if (
    item.admission.state === 'open'
    && item.admission.currency === 'usd'
    && Number.isSafeInteger(item.admission.minimumBuyerAmountMinor)
    && (item.admission.minimumBuyerAmountMinor ?? -1) >= 0
  ) {
    return `From ${formatBuyerMoney(item.admission.minimumBuyerAmountMinor!)}`
  }
  return 'View prices'
}

export function discoverySchedule(item: DiscoveryDisplayItem): string {
  return formatBuyerSchedule(item.startsAt, item.endsAt, item.timezone)
}

export function selectDiscoveryHighlight(items: readonly DiscoveryDisplayItem[]): DiscoveryDisplayItem | null {
  return items.find((item) => item.artworkReference !== null && item.admission.state === 'open') ?? null
}
