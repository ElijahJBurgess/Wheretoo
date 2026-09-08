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
  quantities: Readonly<Record<string, number>>
  maxTotal: number
  tiers: PublicTicketTierTuple
  onQuantityChange: (tierId: string, quantity: number) => void
}

export function TicketTierList({ quantities, maxTotal, tiers, onQuantityChange }: TicketTierListProps) {
  const total = tiers.reduce((sum, tier) => sum + (quantities[tier.id] ?? 0), 0)
  const hasInvalidQuantity = tiers.some((tier) => {
    const quantity = quantities[tier.id] ?? 0
    return tier.availability_status === 'available' &&
      (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > maxTotal)
  })
  const aggregateMessage = total > maxTotal
    ? `${total} tickets selected. Maximum ${maxTotal}.`
    : hasInvalidQuantity
    ? `Enter whole quantities from 0 to ${maxTotal}.`
    : `${total} of ${maxTotal} tickets selected`

  return (
    <fieldset className="public-ticket-tiers">
      <legend>Choose quantities</legend>
      <div className="public-ticket-tiers__options">
        {tiers.map((tier) => {
          const available = tier.availability_status === 'available'
          const quantity = available ? quantities[tier.id] ?? 0 : 0
          const selected = available && quantity > 0

          return (
            <div className={`public-ticket-tier${selected ? ' public-ticket-tier--selected' : ''}`} key={tier.id}>
              <span className="public-ticket-tier__copy">
                <span className="public-ticket-tier__header">
                  <strong>{tier.name}</strong>
                  <strong>{formatTicketPrice(tier.unit_amount_minor)}</strong>
                </span>
                {tier.description === null ? null : <span>{tier.description}</span>}
              </span>
              <span className="public-ticket-tier__quantity">
                <label htmlFor={`ticket-quantity-${tier.id}`}>{available ? 'Quantity' : 'Sold out'}</label>
                <input
                  aria-describedby="ticket-quantity-limit"
                  aria-invalid={hasInvalidQuantity || total > maxTotal ? true : undefined}
                  aria-label={`${tier.name} quantity`}
                  disabled={!available}
                  id={`ticket-quantity-${tier.id}`}
                  inputMode="numeric"
                  max={maxTotal}
                  min={0}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber
                    onQuantityChange(tier.id, Number.isNaN(next) ? 0 : next)
                  }}
                  step={1}
                  type="number"
                  value={quantity}
                />
              </span>
            </div>
          )
        })}
      </div>
      <p aria-live="polite" className={hasInvalidQuantity || total > maxTotal ? 'public-ticket-tiers__limit public-ticket-tiers__limit--invalid' : 'public-ticket-tiers__limit'} id="ticket-quantity-limit" role="status">
        {aggregateMessage}
      </p>
    </fieldset>
  )
}
