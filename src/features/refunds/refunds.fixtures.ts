// Synthetic fixtures shared by refund tests only.
export const refundFixture = {
  orderId: '11111111-1111-4111-8111-111111111111', eventId: '22222222-2222-4222-8222-222222222222',
  orderNumber: 'WT-TEST', eventName: 'Synthetic Rooftop', buyerName: 'Test Guest', buyerEmail: 'guest@example.invalid',
  currency: 'usd' as const, totalMinor: 7000, quantity: 3,
  items: [{ tierName: 'GA', quantity: 2, subtotalMinor: 4000 }, { tierName: 'VIP', quantity: 1, subtotalMinor: 3000 }],
  tickets: [
    { id: '33333333-3333-4333-8333-333333333333', admissionLabel: 'GA', status: 'used' as const, usedAt: '2026-09-10T20:00:00Z' },
    { id: '44444444-4444-4444-8444-444444444444', admissionLabel: 'GA', status: 'valid' as const, usedAt: null },
    { id: '55555555-5555-4555-8555-555555555555', admissionLabel: 'VIP', status: 'valid' as const, usedAt: null },
  ], state: 'eligible' as const, action: 'submit' as const, requestedAt: null, completedAt: null,
}
export const detailFixture = { kind: 'ready' as const, expiresAt: '2099-10-01T00:00:00Z', order: {
  orderNumber: 'WT-TEST', eventName: 'Synthetic Rooftop', startsAt: '2026-09-10T19:00:00Z', endsAt: '2026-09-10T23:00:00Z', timezone: 'America/Los_Angeles', venueName: 'Test Hall',
  currency: 'usd' as const, totalMinor: 7000, subtotalMinor: 7000, quantity: 3, items: refundFixture.items, refundAmountMinor: 7000, completedAt: '2026-09-11T00:00:00Z',
  tickets: refundFixture.tickets.map(ticket => ({ ...ticket, status: ticket.status === 'used' ? 'used' as const : 'refunded' as const })),
} }
