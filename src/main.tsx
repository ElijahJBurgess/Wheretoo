import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
const isTicketSelectionPreview = window.location.pathname === '/preview/ticket-selection'

if (isTicketSelectionPreview) {
  import('./features/tickets/TicketSelectionPreviewPage').then(({ TicketSelectionPreviewPage }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <TicketSelectionPreviewPage />
      </StrictMode>,
    )
  })
} else {
  Promise.all([import('./app/App'), import('./app/providers/AppProviders')]).then(([{ App }, { AppProviders }]) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AppProviders>
          <App />
        </AppProviders>
      </StrictMode>,
    )
  })
}
