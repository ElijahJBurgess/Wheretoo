// Dedicated development-only test entry. The production app never imports this module.
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import '../../../src/styles/global.css'
import '../../../src/features/organizer-operations/organizer-operations.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { supabase } from '../../../src/lib/supabase/client'
import { SessionProvider, useSession } from '../../../src/features/auth/SessionProvider'
import { OperationsLayout } from '../../../src/features/organizer-operations/OperationsUi'
import { OrganizerOrderDetailPage } from '../../../src/features/organizer-operations/OrganizerOrderDetailPage'
import { RefundOrderPanel } from '../../../src/features/refunds/RefundOrderPanel'
import { refundRoutes } from '../../../src/features/refunds/refundRoutes'
const params = new URLSearchParams(window.location.search)
const eventId = params.get('eventId') ?? '22222222-2222-4222-8222-222222222222'
const orderId = params.get('orderId') ?? '11111111-1111-4111-8111-111111111111'
const view = params.get('view') ?? 'panel'
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
export function Panel() {
 const session = useSession()
 if (session.status === 'loading') return <p role='status'>Loading test session…</p>
 return <OperationsLayout eventId={eventId} staffRole={null} onSignOut={() => void supabase.auth.signOut({ scope: 'local' })}><section className='operations-page ops-detail'><h1>Order Details</h1><RefundOrderPanel ownerId={session.status === 'authenticated' ? session.user.id : ''} eventId={eventId} orderId={orderId} /></section></OperationsLayout>
}
export function Order() { return <OperationsLayout eventId={eventId} staffRole={null} onSignOut={() => void supabase.auth.signOut({ scope: 'local' })}><OrganizerOrderDetailPage /></OperationsLayout> }
const orderPath = `/organizer/events/${eventId}/orders/${orderId}`
const router = createMemoryRouter([...refundRoutes, { path: '/panel', element: <Panel /> }, { path: '/organizer/events/:eventId/orders/:orderId', element: <Order /> }], { initialEntries: [view === 'buyer' ? '/refund-details' : view === 'order' ? orderPath : '/panel'] })
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><SessionProvider queryClient={client}><RouterProvider router={router} /></SessionProvider></QueryClientProvider></StrictMode>)
