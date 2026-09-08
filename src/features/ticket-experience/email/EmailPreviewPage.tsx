import { useEffect, useState, type CSSProperties } from 'react'
import { AsyncState } from '../../../components/ui/AsyncState'
import type { EmailTemplateInput } from './email.types'
import { emailRenderer } from './renderEmail'

type PreviewState =
  | { kind: 'loading'; input: EmailTemplateInput }
  | { kind: 'ready'; html: string; input: EmailTemplateInput }
  | { kind: 'error'; input: EmailTemplateInput }

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  padding: 'clamp(1rem, 4vw, 2.5rem)',
  background: '#f3f1f8',
}

const headerStyle: CSSProperties = {
  width: 'min(100%, 680px)',
  margin: '0 auto 1rem',
}

const iframeStyle: CSSProperties = {
  display: 'block',
  width: 'min(100%, 760px)',
  minHeight: '760px',
  margin: '0 auto',
  border: '1px solid #d8d3e5',
  borderRadius: '16px',
  background: '#ffffff',
}

function fitPreviewHeight(frame: HTMLIFrameElement) {
  const height = frame.contentDocument?.documentElement.scrollHeight
  if (height) frame.style.height = `${height}px`
}

export function EmailPreviewPage({ input }: { input: EmailTemplateInput }) {
  const [storedState, setState] = useState<PreviewState>(() => ({ kind: 'loading', input }))
  const state: PreviewState = storedState.input === input ? storedState : { kind: 'loading', input }

  useEffect(() => {
    let active = true
    emailRenderer.render(input).then(
      ({ html }) => {
        if (active) setState({ kind: 'ready', html, input })
      },
      () => {
        if (active) setState({ kind: 'error', input })
      },
    )
    return () => { active = false }
  }, [input])

  if (state.kind === 'loading') {
    return <main className="email-preview-page" style={pageStyle}><AsyncState status="loading" title="Rendering email preview" /></main>
  }

  if (state.kind === 'error') {
    return <main className="email-preview-page" style={pageStyle}><AsyncState status="error" title="Email preview unavailable" /></main>
  }

  return (
    <main className="email-preview-page" style={pageStyle}>
      <header className="email-preview-page__header" style={headerStyle}>
        <p>Development preview</p>
        <h1>Email shell</h1>
        <p>Rendering only. No message can be sent from this page.</p>
      </header>
      <iframe
        onLoad={(event) => fitPreviewHeight(event.currentTarget)}
        sandbox="allow-same-origin"
        srcDoc={state.html}
        style={iframeStyle}
        title="Email preview"
      />
    </main>
  )
}
