import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TicketTierList } from './TicketTierList'
import type { PublicTicketTierTuple } from './ticket.types'

const gaTierId = '900a9142-9111-4f87-84d5-b8545a94c7fb'
const vipTierId = '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe'
const tiers: PublicTicketTierTuple = [{
  id: gaTierId,
  name: 'General admission',
  description: 'Entry to the market.',
  unit_amount_minor: 2_500,
  currency: 'usd',
  availability_status: 'available',
}, {
  id: vipTierId,
  name: 'VIP',
  description: 'Early entry.',
  unit_amount_minor: 7_500,
  currency: 'usd',
  availability_status: 'sold_out',
}]

describe('TicketTierList', () => {
  it('offers labeled keyboard-operable integer quantities and reports the aggregate limit live', async () => {
    const onQuantityChange = vi.fn()
    render(
      <TicketTierList
        maxTotal={10}
        onQuantityChange={onQuantityChange}
        quantities={{ [gaTierId]: 2, [vipTierId]: 0 }}
        tiers={tiers}
      />,
    )

    const quantity = screen.getByRole('spinbutton', { name: 'General admission quantity' })
    expect(quantity).toHaveAttribute('min', '0')
    expect(quantity).toHaveAttribute('max', '10')
    expect(screen.getByRole('status')).toHaveTextContent('2 of 10 tickets selected')

    fireEvent.change(quantity, { target: { value: '3' } })
    expect(onQuantityChange).toHaveBeenCalledWith(gaTierId, 3)
  })

  it('disables sold-out quantity controls and communicates their state', () => {
    render(
      <TicketTierList
        maxTotal={10}
        onQuantityChange={vi.fn()}
        quantities={{ [gaTierId]: 0, [vipTierId]: 0 }}
        tiers={tiers}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: 'VIP quantity' })).toBeDisabled()
    expect(screen.getByText('Sold out')).toBeInTheDocument()
  })

  it('announces an aggregate overflow without hiding the entered value', () => {
    render(
      <TicketTierList
        maxTotal={10}
        onQuantityChange={vi.fn()}
        quantities={{ [gaTierId]: 11, [vipTierId]: 0 }}
        tiers={tiers}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('11 tickets selected. Maximum 10.')
    expect(screen.getByRole('spinbutton', { name: 'General admission quantity' })).toHaveValue(11)
  })
})
