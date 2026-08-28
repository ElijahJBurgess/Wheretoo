import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refetch, useModerationQueue, useStaffContext } = vi.hoisted(() => ({
  refetch: vi.fn(),
  useModerationQueue: vi.fn(),
  useStaffContext: vi.fn(),
}))

vi.mock('./staffContext', () => ({ useStaffContext }))
vi.mock('./moderation.queries', () => ({ useModerationQueue }))

import { ModerationQueuePage } from './ModerationQueuePage'

const cases = [
  {
    eventId: '28000000-0000-4000-8000-000000000006', organizerId: '18000000-0000-4000-8000-000000000005',
    moderationStatus: 'under_review', contentRevision: 3, inputSha256: 'a'.repeat(64), moderationVersion: 8,
    publicHistoryStatus: 'never_public', currentOpenReviewRequest: true, currentReportCount: 2,
    queuedEvaluationCount: 1, oldestQueuedAt: '2026-08-27T12:00:00Z',
  },
  {
    eventId: '28000000-0000-4000-8000-000000000003', organizerId: '18000000-0000-4000-8000-000000000005',
    moderationStatus: 'under_review', contentRevision: 2, inputSha256: 'b'.repeat(64), moderationVersion: 5,
    publicHistoryStatus: 'previously_public', currentOpenReviewRequest: false, currentReportCount: 3,
    queuedEvaluationCount: 0, oldestQueuedAt: null,
  },
] as const

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/moderation']}>
      <Routes>
        <Route path="/moderation" element={<ModerationQueuePage />} />
        <Route path="/moderation/events/:eventId" element={<p>case destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ModerationQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStaffContext.mockReturnValue({ role: 'moderator', staffUserId: 'staff-1' })
    useModerationQueue.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
  })

  it('uses the authenticated staff identity and shows loading without queue rows', () => {
    renderPage()
    expect(useModerationQueue).toHaveBeenCalledWith('staff-1')
    expect(screen.getByText('Loading moderation queue')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders a retryable error and an actionable empty state', async () => {
    const user = userEvent.setup()
    useModerationQueue.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    const view = renderPage()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()

    useModerationQueue.mockReturnValue({ data: [], isPending: false, isError: false, refetch })
    view.rerender(
      <MemoryRouter initialEntries={['/moderation']}>
        <ModerationQueuePage />
      </MemoryRouter>,
    )
    expect(screen.getByText('No cases need attention')).toBeInTheDocument()
  })

  it('preserves server priority order and shows only bounded aggregate signals', async () => {
    const user = userEvent.setup()
    useModerationQueue.mockReturnValue({ data: cases, isPending: false, isError: false, refetch })
    renderPage()

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', `/moderation/events/${cases[0].eventId}`)
    expect(screen.getByText('Review requested')).toBeInTheDocument()
    expect(screen.getByText('2 reports')).toBeInTheDocument()
    expect(screen.getByText('3 reports')).toBeInTheDocument()
    expect(screen.queryByText(/reporter|fingerprint|provider|model|reasoning/i)).not.toBeInTheDocument()

    await user.click(links[0])
    expect(await screen.findByText('case destination')).toBeInTheDocument()
  })
})
