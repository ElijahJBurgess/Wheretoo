import type { PublicTicketTierTuple } from './ticket.types'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatTicketPrice(unitAmountMinor: number): string {
  return usdFormatter.format(unitAmountMinor / 100)
}

type TicketTierListProps = {
  selectedTierId: string | null
  tiers: PublicTicketTierTuple
  onSelect: (tierId: string) => void
}

export function TicketTierList({ selectedTierId, tiers, onSelect }: TicketTierListProps) {
  return (
    <fieldset className="public-ticket-tiers">
      <legend>Select a ticket</legend>
      <div className="public-ticket-tiers__options">
        {tiers.map((tier) => {
          const available = tier.availability_status === 'available'
          const selected = available && selectedTierId === tier.id

          return (
            <label className={`public-ticket-tier${selected ? ' public-ticket-tier--selected' : ''}`} key={tier.id}>
              <input
                checked={selected}
                disabled={!available}
                name="ticket-tier"
                onChange={() => onSelect(tier.id)}
                type="radio"
                value={tier.id}
              />
              <span className="public-ticket-tier__copy">
                <span className="public-ticket-tier__header">
                  <strong>{tier.name}</strong>
                  <strong>{formatTicketPrice(tier.unit_amount_minor)}</strong>
                </span>
                {tier.description === null ? null : <span>{tier.description}</span>}
              </span>
              {available ? null : <span className="public-ticket-tier__sold-out">Sold out</span>}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
