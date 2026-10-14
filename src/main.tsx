import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/global.css'
import { createRoot } from 'react-dom/client'
import { renderApplication } from './app/bootstrap'

const isPreviewPath = window.location.pathname === '/preview' || window.location.pathname.startsWith('/preview/')
const root = createRoot(document.getElementById('root')!)

if (isPreviewPath) {
  if (import.meta.env.VITE_SCREEN_PREVIEW_ENABLED) {
    void renderApplication(root, import('./preview/PreviewApp').then(({ PreviewApp }) => <PreviewApp />))
  } else {
    root.render(<main><h1>Page not found</h1></main>)
  }
} else {
  void renderApplication(root, Promise.all([
    import('./app/App'),
    import('./app/providers/AppProviders'),
    import('./app/router/router'),
    import('./features/ticket-experience/runtime/production'),
  ]).then(([{ App }, { AppProviders }, { createAppRouter }, { productionTicketExperienceRuntime }]) => {
    const router = createAppRouter(productionTicketExperienceRuntime)
    return <AppProviders><App router={router} /></AppProviders>
  }))
}
