import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useEventMetrics: vi.fn(), useOperationsMetrics: vi.fn() }))
vi.mock('./operations.queries', () => ({ useEventMetrics: mocks.useEventMetrics, useOperationsMetrics: mocks.useOperationsMetrics }))
vi.mock('./CheckInContext', () => ({ useCheckInContext: () => ({
  ownerId: 'owner', identityVersion: 7, eventId: 'a6200000-0000-4000-8000-000000000001', sourceKind: 'free_registration',
  event: { title: 'Community supper', status: 'published', admission_type: 'free', starts_at: '2026-09-14T12:00:00Z', ends_at: '2126-09-14T15:00:00Z', timezone: 'America/Los_Angeles', venue_name: 'Town Hall', city: 'Oakland', artwork_path: null },
}) }))

import { CheckInHomePage } from './CheckInHomePage'

it('mounts a free check-in home without a paid metrics read', () => {
  mocks.useOperationsMetrics.mockReturnValue({ data: { eventId: 'a6200000-0000-4000-8000-000000000001', checkedIn: 1, issued: 3 }, isSuccess: true, isError: false })
  render(<MemoryRouter><CheckInHomePage /></MemoryRouter>)
  expect(mocks.useEventMetrics).not.toHaveBeenCalled()
  expect(mocks.useOperationsMetrics).toHaveBeenCalledWith('owner', 'a6200000-0000-4000-8000-000000000001', 'free_registration', 7)
  expect(screen.getByRole('link', { name: 'Scan QR' })).toBeVisible()
  expect(screen.getByText('1 / 3 checked in')).toBeVisible()
})
