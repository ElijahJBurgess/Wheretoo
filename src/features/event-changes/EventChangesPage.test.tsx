import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { testContext } from './eventChanges.fixtures'
const { useContext, panel } = vi.hoisted(() => ({ useContext: vi.fn(), panel: vi.fn() }))
vi.mock('./eventChanges.queries', () => ({ useEventChangeContext: useContext }))
vi.mock('./EventNoticePanel', () => ({ EventNoticePanel: (props: unknown) => { panel(props); return <p>Notice review</p> } }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' } }) }))
import { EventChangesPage } from './EventChangesPage'
it('distinguishes saved and actual public history and explicitly unavailable legacy snapshots', () => {
 const context = testContext(); context.notice_required = true; context.current_publicly_eligible = context.current_saved
 useContext.mockReturnValue({ data: context, isPending: false, isError: false, refetch: vi.fn() })
 render(<MemoryRouter initialEntries={['/organizer/events/event-1/changes']}><Routes><Route path="/organizer/events/:eventId/changes" element={<EventChangesPage />} /></Routes></MemoryRouter>)
 expect(screen.getByText(/Previous saved unavailable/)).toBeInTheDocument(); expect(screen.getByText(/Previous public unavailable/)).toBeInTheDocument()
 expect(screen.getByText('View current saved details')).toBeInTheDocument(); expect(screen.getByText('View latest actual public details')).toBeInTheDocument()
 expect(screen.getByText(/Notice required/)).toBeInTheDocument(); expect(screen.queryByText('Unavailable — no recorded snapshot')).not.toBeInTheDocument()
 expect(panel).toHaveBeenCalledWith(expect.objectContaining({ expectedSnapshotId: context.current_saved.snapshot_id }))
})
