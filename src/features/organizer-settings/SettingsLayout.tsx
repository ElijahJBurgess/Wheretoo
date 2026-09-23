import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import './organizer-settings.css'

const sections = [
  ['account', 'Account & Security', 'Your account name, login email and password.'],
  ['storefront', 'Storefront', 'Your permanent public home for events.'],
  ['profile', 'Organizer Profile', 'The name and story behind your events.'],
  ['payments', 'Payments & Payouts', 'Review your Stripe setup for paid ticket sales.'],
  ['help', 'Help & Legal', 'Support, policies and useful information.'],
  ['actions', 'Account Actions', 'Sign out or request a manual account review.'],
] as const

export function SettingsLayout() {
  const { pathname } = useLocation()
  if (pathname === '/organizer/settings/storefront/preview') return <Outlet />
  const index = pathname.replace(/\/$/, '') === '/organizer/settings'
  return <div className={`settings-page ${index ? 'settings-page--index' : 'settings-page--detail'}`}>
    <header className='settings-header'><p className='organizer-eyebrow'>YOUR ORGANIZER ACCOUNT</p><h1>Settings</h1><p>Manage your account and organizer settings.</p></header>
    <div className='settings-grid'>
      <nav className='settings-nav' aria-label='Settings sections'>{sections.map(([path, title, description]) => <NavLink key={path} to={`/organizer/settings/${path}`}><span>{title}</span><small>{description}</small><b aria-hidden='true'>↗</b></NavLink>)}</nav>
      <div className='settings-content'>
        {!index && <Link className='settings-back' to='/organizer/settings'>← Back to Settings</Link>}
        <Outlet />
      </div>
    </div>
  </div>
}

export function SettingsIndexPage() {
  return null
}
