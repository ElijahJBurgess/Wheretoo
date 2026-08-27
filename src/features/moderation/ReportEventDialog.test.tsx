import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync, reset, useReportPublicEvent } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  useReportPublicEvent: vi.fn(),
}))
vi.mock('./moderation.queries', () => ({ useReportPublicEvent }))

import { ReportEventDialog } from './ReportEventDialog'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'

describe('ReportEventDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReportPublicEvent.mockReturnValue({ isPending: false, mutateAsync, reset })
    mutateAsync.mockResolvedValue({ status: 'received' })
  })

  it('opens a semantic dialog with exactly eight structured reasons and no free text', async () => {
    const user = userEvent.setup()
    render(<ReportEventDialog eventId={eventId} />)

    await user.click(screen.getByRole('button', { name: 'Report this event' }))

    const dialog = screen.getByRole('dialog', { name: 'Report this event' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getAllByRole('radio')).toHaveLength(8)
    expect(screen.getByRole('group', { name: 'Why are you reporting this event?' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio')[0]).toHaveFocus()
  })

  it('closes on Escape and returns focus to the report trigger', async () => {
    const user = userEvent.setup()
    render(<ReportEventDialog eventId={eventId} />)
    const trigger = screen.getByRole('button', { name: 'Report this event' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('submits one allowlisted reason, closes, resets, and restores focus on duplicate-safe success', async () => {
    const user = userEvent.setup()
    let resolveSubmission: ((value: { status: 'received' }) => void) | undefined
    mutateAsync.mockImplementation(() => new Promise((resolve) => { resolveSubmission = resolve }))
    render(<ReportEventDialog eventId={eventId} />)
    const trigger = screen.getByRole('button', { name: 'Report this event' })

    await user.click(trigger)
    await user.click(screen.getByRole('radio', { name: 'Scam or misleading' }))
    const submit = screen.getByRole('button', { name: 'Send report' })
    await user.dblClick(submit)
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync).toHaveBeenCalledWith('scam_misleading')

    await act(async () => { resolveSubmission?.({ status: 'received' }) })
    await screen.findByRole('status')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Report received')

    await user.click(trigger)
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    expect(screen.queryByText(/report count|moderation outcome|removed/i)).not.toBeInTheDocument()
  })

  it.each([
    Object.assign(new Error('This event is no longer available.'), { code: 'NOT_FOUND' }),
    new Error('private report table detail'),
  ])('keeps unknown, nonpublic, and service failures bounded inside the dialog', async (failure) => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(failure)
    render(<ReportEventDialog eventId={eventId} />)

    await user.click(screen.getByRole('button', { name: 'Report this event' }))
    await user.click(screen.getByRole('radio', { name: 'Event does not exist' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(screen.getByRole('alert')).toHaveTextContent('We could not send this report. The event may no longer be available. Try again.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/private report table|PGRST|moderation_status/i)).not.toBeInTheDocument()
  })

  it('returns focus when cancelled without sending or retaining a selection', async () => {
    const user = userEvent.setup()
    render(<ReportEventDialog eventId={eventId} />)
    const trigger = screen.getByRole('button', { name: 'Report this event' })

    await user.click(trigger)
    await user.click(screen.getByRole('radio', { name: 'Unsafe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
  })
})
