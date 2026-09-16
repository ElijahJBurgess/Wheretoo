import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { MAX_CHECKOUT_QUANTITY } from '../checkout/checkout.cart'
import { EventPageView } from '../buyer-journey/EventPageView'
import { TicketTierList } from './TicketTierList'
import type { PublicTicketTierTuple } from './ticket.types'

const mockTiers = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'General Admission', description: 'Access to event', unit_amount_minor: 2500, currency: 'usd', availability_status: 'available' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'VIP', description: 'Priority entry + exclusive lounge', unit_amount_minor: 6000, currency: 'usd', availability_status: 'available' },
] satisfies PublicTicketTierTuple

export function TicketSelectionPreviewPage({ artwork, back, initialQuantities, onContinue }: {
  artwork?: string; back?: ReactNode; initialQuantities?: Readonly<Record<string, number>>; onContinue?: (quantities: Readonly<Record<string, number>>) => void
}) {
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>(initialQuantities ?? { [mockTiers[0].id]: 1 })
  const total = mockTiers.reduce((sum, tier) => sum + (quantities[tier.id] ?? 0), 0)
  const validCart = total > 0 && total <= MAX_CHECKOUT_QUANTITY && Object.values(quantities).every((quantity) => Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= MAX_CHECKOUT_QUANTITY)
  return <EventPageView title="Sunset Rooftop Sessions" organizer="good company" date="Sat Sep 19 · 7:00 PM" venue="Lakeview Rooftop" location="Oakland, CA" description="Afro house, open-air vibes, skyline views." artwork={artwork} back={back} selection>
    <section aria-labelledby="preview-tickets-title" className="public-event__tickets">
      <div className="buyer-section-heading"><h2 id="preview-tickets-title">Tickets</h2><span>From $25</span></div>
      <TicketTierList maxTotal={MAX_CHECKOUT_QUANTITY} onQuantityChange={(tierId, quantity) => setQuantities((current) => ({ ...current, [tierId]: quantity }))} quantities={quantities} tiers={mockTiers} />
      <Button disabled={!validCart} onClick={() => onContinue?.(quantities)}>Get tickets</Button>
    </section>
  </EventPageView>
}
