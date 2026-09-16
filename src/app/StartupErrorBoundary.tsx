import { Component, type ReactNode } from 'react'
import { startupFailureCopy } from './startupFailure'

type StartupErrorBoundaryProps = { children: ReactNode }
type StartupErrorBoundaryState = { failed: boolean }

export class StartupErrorBoundary extends Component<StartupErrorBoundaryProps, StartupErrorBoundaryState> {
  state: StartupErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): StartupErrorBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="ui-page-shell">
          <h1>{startupFailureCopy.title}</h1>
          <p>{startupFailureCopy.description}</p>
          <a className="ui-button ui-button--primary" href="/auth/sign-in">{startupFailureCopy.action}</a>
        </main>
      )
    }
    return this.props.children
  }
}
