import { StrictMode, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { AsyncState } from '../components/ui/AsyncState'
import { Button } from '../components/ui/Button'

export async function renderApplication(root: Root, application: Promise<ReactNode>): Promise<void> {
  root.render(<main><AsyncState status="loading" title="Loading Whereto" /></main>)

  try {
    const content = await application
    root.render(<StrictMode>{content}</StrictMode>)
  } catch {
    root.render(
      <main>
        <AsyncState
          action={<Button onClick={() => window.location.reload()}>Reload page</Button>}
          description="Check your connection, then reload this page to try again."
          status="error"
          title="Whereto could not load"
        />
      </main>,
    )
  }
}
