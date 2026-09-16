import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import { RefundSupportContext } from './RefundedTicketContext'
it('uses only the configured support address and never turns an invalid address into a link', () => {
 const { rerender } = render(<DeliverySupport email='refund-support@example.invalid' />)
 expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:refund-support%40example.invalid')
 rerender(<DeliverySupport email='javascript:alert(1)' />)
 expect(screen.queryByRole('link')).not.toBeInTheDocument()
 rerender(<DeliverySupport email='' />)
 expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
it('provides safe refund support context without inventing a recovery or organizer channel', () => {
 render(<RefundSupportContext orderNumber='WT-SYNTHETIC' />)
 expect(screen.getByText('Order #WT-SYNTHETIC')).toBeVisible()
 expect(screen.queryByRole('link', { name: /organizer|recover|tickets/i })).not.toBeInTheDocument()
})
