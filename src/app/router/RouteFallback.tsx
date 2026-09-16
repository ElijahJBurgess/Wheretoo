import { Link } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'

const signInAction = <Link className="ui-button ui-button--primary" to="/auth/sign-in">Go to sign in</Link>

export function RouteLoadingFallback() {
  return (
    <div className="ui-page-shell">
      <AsyncState
        description="Whereto is opening this page."
        headingAs="h1"
        status="loading"
        title="Loading page"
      />
    </div>
  )
}

export function UnmatchedRouteFallback() {
  return (
    <main className="ui-page-shell">
      <AsyncState
        action={signInAction}
        description="The page you requested is not available."
        headingAs="h1"
        status="not-found"
        title="Page not found"
      />
    </main>
  )
}

export function RouteErrorFallback() {
  return (
    <div className="ui-page-shell">
      <AsyncState
        action={signInAction}
        description="This page could not be opened. You can return to sign in safely."
        headingAs="h1"
        status="unavailable"
        title="Page unavailable"
      />
    </div>
  )
}
