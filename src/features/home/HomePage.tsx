import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { WheretooLogo } from '../../components/brand/WheretooLogo'
import './home.css'

const HomeMap = lazy(() => import('../../map/LivingMapPage').then(module => ({ default: module.Component })))

export function HomePage() {
  return <div className="discovery-home">
    <header className="discovery-home__header">
      <Link to="/" aria-label="Wheretoo home"><WheretooLogo theme="white" width={140} /></Link>
      <nav aria-label="Main navigation">
        <Link to="/map">Explore the map</Link>
        <Link className="discovery-home__organizer-link" to="/organizer/events">For organizers <span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
    <main>
      <section className="discovery-home__intro" aria-labelledby="home-title">
        <div><p className="discovery-home__eyebrow"><span aria-hidden="true" /> San Francisco · Oakland · The Bay</p>
          <h1 id="home-title">Your city.<br /><span>Your next plan.</span></h1>
        </div>
        <div className="discovery-home__invitation"><p>A night out. A new favorite spot. Something a little unexpected. Find what’s happening around you.</p>
          <Link className="discovery-home__primary" to="/map">Explore the map <span aria-hidden="true">↗</span></Link>
          <span>No account needed to explore.</span>
        </div>
      </section>
      <section className="discovery-home__map" aria-label="Discover events on the map">
        <Suspense fallback={<div className="discovery-home__map-loading" role="status">Loading the city map…</div>}><HomeMap embedded /></Suspense>
      </section>
      <section className="discovery-home__host" aria-labelledby="host-title">
        <div><p className="discovery-home__eyebrow">Bring people together</p><h2 id="host-title">Put your event on the map.</h2>
          <p>Create your event, share tickets, and welcome your crowd.</p>
        </div><Link className="discovery-home__secondary" to="/auth/sign-up">Create an event <span aria-hidden="true">↗</span></Link>
      </section>
    </main>
    <footer className="discovery-home__footer"><WheretooLogo theme="white" width={100} />
      <span>Go find your people.</span><nav aria-label="Policies"><Link to="/event-policy">Event policy</Link><Link to="/organizer-terms">Organizer terms</Link></nav>
    </footer>
  </div>
}
