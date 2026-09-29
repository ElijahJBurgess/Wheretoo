import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { OperationsLayout } from './OperationsUi'

function show(admissionType: 'paid' | 'free' | null) {
  return render(<MemoryRouter><OperationsLayout eventId='a6200000-0000-4000-8000-000000000001' admissionType={admissionType} onSignOut={() => undefined} staffRole={null}><p>Page</p></OperationsLayout></MemoryRouter>)
}

it('shows only the navigation for the confirmed event source and none while unknown', () => {
  const free = show('free')
  expect(screen.getByRole('link', { name: /Registrations/ })).toBeVisible()
  expect(screen.queryByRole('link', { name: /Orders/ })).not.toBeInTheDocument()
  free.unmount()

  const paid = show('paid')
  expect(screen.getByRole('link', { name: /Orders/ })).toBeVisible()
  expect(screen.queryByRole('link', { name: /Registrations/ })).not.toBeInTheDocument()
  paid.unmount()

  show(null)
  expect(screen.queryByRole('link', { name: /Orders|Registrations/ })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /My Events/ })).toBeVisible()
  expect(screen.getByRole('link', { name: /Settings/ })).toBeVisible()
})

it.each(['/organizer/settings/storefront', '/organizer/events'])('keeps primary navigation coherent at %s', path => {
  render(<MemoryRouter initialEntries={[path]}><OperationsLayout onSignOut={() => undefined} staffRole={null}><p>Page</p></OperationsLayout></MemoryRouter>)
  const storefront = screen.getByRole('link', { name: 'Storefront' })
  expect(storefront).toHaveAttribute('href', '/organizer/settings/storefront')
  expect(storefront.previousElementSibling).toBe(screen.getByRole('link', { name: 'My Events' }))
  expect(screen.getByRole('link', { name: path.endsWith('storefront') ? 'Storefront' : 'My Events' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: /Settings/ })).not.toHaveAttribute('aria-current')
})
