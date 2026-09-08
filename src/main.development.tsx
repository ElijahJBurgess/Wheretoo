import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const isPreviewPath = window.location.pathname === '/preview' || window.location.pathname.startsWith('/preview/')

if (isPreviewPath) {
  if (import.meta.env.VITE_SCREEN_PREVIEW_ENABLED) {
    import('./preview/PreviewApp').then(({ PreviewApp }) => {
      createRoot(document.getElementById('root')!).render(<StrictMode><PreviewApp /></StrictMode>)
    })
  } else {
    createRoot(document.getElementById('root')!).render(<main><h1>Page not found</h1></main>)
  }
} else {
  Promise.all([
    import('./app/App'),
    import('./app/providers/AppProviders'),
    import('./app/router/router'),
    import('./features/ticket-experience/runtime/development'),
  ]).then(([{ App }, { AppProviders }, { createAppRouter }, { developmentTicketExperienceRuntime }]) => {
    const router = createAppRouter(developmentTicketExperienceRuntime)
    createRoot(document.getElementById('root')!).render(
      <StrictMode><AppProviders><App router={router} /></AppProviders></StrictMode>,
    )
  })
}
