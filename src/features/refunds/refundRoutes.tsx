import type { RouteObject } from 'react-router-dom'
import { RefundDetailsPage } from './RefundDetailsPage'
// Standalone mount permits integration proof without changing concurrently owned router files.
export const refundRoutes: RouteObject[] = [{ path: '/refund-details', element: <RefundDetailsPage /> }]
