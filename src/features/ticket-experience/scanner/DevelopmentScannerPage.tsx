import { useState, type FormEvent, type ReactNode } from 'react'
import { OrganizerScannerView } from './OrganizerScannerView'
import { useScannerController, type OrganizerScannerPageProps } from './useScannerController'

type DevelopmentScannerPageProps = OrganizerScannerPageProps & {
  scenarioControl?: ReactNode
}

export function DevelopmentScannerPage({ scenarioControl, ...props }: DevelopmentScannerPageProps) {
  const controller = useScannerController(props)
  const [muted, setMuted] = useState(false)
  const [credential, setCredential] = useState('')

  function submitFakeCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!credential) return
    controller.submitDecoded(credential)
    setCredential('')
  }

  const developmentControl = (
    <form data-development-control onSubmit={submitFakeCredential}>
      <strong>Development only</strong>
      <label htmlFor="fake-admission-credential">Fake admission credential</label>
      <div>
        <input
          autoComplete="off"
          disabled={controller.state.kind !== 'ready'}
          id="fake-admission-credential"
          onChange={(event) => setCredential(event.target.value)}
          value={credential}
        />
        <button disabled={controller.state.kind !== 'ready' || !credential} type="submit">
          Submit fake credential
        </button>
      </div>
    </form>
  )

  return (
    <OrganizerScannerView
      controller={controller}
      developmentControl={scenarioControl || controller.state.kind === 'ready'
        ? <>{scenarioControl}{controller.state.kind === 'ready' ? developmentControl : null}</>
        : undefined}
      muted={muted}
      onToggleMute={() => setMuted((value) => !value)}
    />
  )
}
