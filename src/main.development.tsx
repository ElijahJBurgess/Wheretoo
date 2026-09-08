import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppProviders } from './app/providers/AppProviders'
import { createAppRouter } from './app/router/router'
import { developmentTicketExperienceRuntime } from './features/ticket-experience/runtime/development'

const router = createAppRouter(developmentTicketExperienceRuntime)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App router={router} />
    </AppProviders>
  </StrictMode>,
)
