import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/global.css'
import { captureTicketAccess } from './features/ticket-delivery/delivery.session'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startApplication } from './app/startApplication'
import { StartupErrorBoundary } from './app/StartupErrorBoundary'

captureTicketAccess()

const isPreviewPath = window.location.pathname === '/preview' || window.location.pathname.startsWith('/preview/')

if (isPreviewPath) {
  if (import.meta.env.VITE_SCREEN_PREVIEW_ENABLED) {
    const root = document.getElementById('root')!
    void startApplication(root, () => import('./preview/PreviewApp'), ({ PreviewApp }) => {
      createRoot(root).render(<StrictMode><StartupErrorBoundary><PreviewApp /></StartupErrorBoundary></StrictMode>)
    })
  } else {
    createRoot(document.getElementById('root')!).render(<main><h1>Page not found</h1></main>)
  }
} else {
  const root = document.getElementById('root')!
  void startApplication(root, () => Promise.all([
    import('./app/App'),
    import('./app/providers/AppProviders'),
    import('./app/router/router'),
    import('./features/ticket-experience/runtime/production'),
  ]), ([{ App }, { AppProviders }, { createAppRouter }, { productionTicketExperienceRuntime }]) => {
    const router = createAppRouter(productionTicketExperienceRuntime)
    createRoot(root).render(
      <StrictMode><StartupErrorBoundary><AppProviders><App router={router} /></AppProviders></StartupErrorBoundary></StrictMode>,
    )
  })
}
