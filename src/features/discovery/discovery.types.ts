import type { EventCategory } from '../events/event.types'

export type DiscoveryWhen = 'upcoming' | 'today' | 'weekend'
export type DiscoveryFilters = { when: DiscoveryWhen; category: EventCategory | null; price: 'free' | 'paid' | null }
export type DiscoveryRequest = {
  region: 'sf_bay_area'; when: DiscoveryWhen; category?: EventCategory; admissionType?: 'free' | 'paid'; limit?: number; cursor?: string
}
export type DiscoveryItem = {
  id: string; title: string; category: EventCategory; admissionType: 'free' | 'paid'
  startsAt: string; endsAt: string; timezone: string; venueName: string | null; city: string
  artworkReference: null
  admission: { state: 'unknown'; minimumBuyerAmountMinor: null; currency: null }
}
export type DiscoveryPageData = {
  items: DiscoveryItem[]; nextCursor: string | null
  window: { start: string; end: string; timezone: 'America/Los_Angeles' }; serverNow: string
  invalidItemCount: number
}

/** Display-only media and states also serve isolated previews. Live responses are stricter. */
export type DiscoveryDisplayItem = Omit<DiscoveryItem, 'artworkReference' | 'admission'> & {
  artworkReference: string | null
  admission: { state: 'unknown' | 'open' | 'full' | 'sales_closed' | 'not_yet_on_sale'; minimumBuyerAmountMinor: number | null; currency: 'usd' | null }
}
