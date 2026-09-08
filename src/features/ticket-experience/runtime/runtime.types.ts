import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router-dom'

export type TicketExperienceRuntime = {
  TicketCollectionRoute: ComponentType
  OrganizerScannerRoute: ComponentType
  OrganizerDashboardRoute: ComponentType
  developmentRoutes: readonly RouteObject[]
}
