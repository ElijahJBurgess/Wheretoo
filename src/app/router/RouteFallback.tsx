import { Link } from 'react-router-dom'
import { WheretooLogo } from '../../components/brand/WheretooLogo'
import './route-fallback.css'

export function RouteLoadingFallback() {
  return <main className="route-fallback"><WheretooLogo /><p role="status">Loading your page…</p></main>
}

export function RouteErrorFallback() {
  return <main className="route-fallback"><WheretooLogo /><h1>This page couldn’t load</h1>
    <p>Check your connection and try again.</p>
    <button className="ui-button ui-button--primary" onClick={() => window.location.reload()}>Try again</button>
    <Link to="/">Back to home</Link>
  </main>
}

export function UnmatchedRouteFallback() {
  return <main className="route-fallback"><WheretooLogo /><h1>Page not found</h1>
    <p>This link may have changed. There’s still a city to explore.</p>
    <Link className="ui-button ui-button--primary" to="/">Explore Wheretoo</Link>
    <Link to="/organizer/events">Organizer dashboard</Link>
  </main>
}
