import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { StorefrontView } from './StorefrontView'
import type { StorefrontDocument } from './storefront.schemas'
export const storefrontFixture: StorefrontDocument = {
  identity: {
    handle: 'night-sessions',
    name: 'Night Sessions',
    bio: 'Live music in Oakland.',
    city: 'Oakland',
    logoId: '24000000-0000-4000-8000-000000000011',
    coverId: null,
    accent: null,
    links: {},
    websiteUrl: null,
  },
  featured: {
    id: '24000000-0000-4000-8000-000000000001',
    title: 'A night of live music',
    startsAt: '2026-10-01T19:00:00-07:00',
    endsAt: '2026-10-01T23:00:00-07:00',
    timezone: 'America/Los_Angeles',
    venue: 'The Music Hall',
    city: 'Oakland',
    flyerId: '24000000-0000-4000-8000-000000000021',
    admissionType: 'paid',
    admission: {
      state: 'available',
      minimumAmountMinor: 1200,
      currency: 'usd',
    },
  },
  events: [],
  nextCursor: null,
  serverNow: '2026-09-23T00:00:00Z',
  merch: [],
  storeUrl: null,
}
it('renders organizer identity and a portrait flyer without engagement metrics', () => {
  render(
    <MemoryRouter>
      <StorefrontView data={storefrontFixture} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: 'Night Sessions' }))
    .toBeInTheDocument()
  expect(screen.getByAltText('A night of live music — flyer')).toHaveClass(
    'storefront-flyer',
  )
  expect(screen.getByText('From $12.00')).toBeInTheDocument()
  expect(screen.queryByText(/followers|going|attendees/i)).not
    .toBeInTheDocument()
})
it('keeps an empty published storefront truthful', () => {
  render(
    <MemoryRouter>
      <StorefrontView data={{ ...storefrontFixture, featured: null }} />
    </MemoryRouter>,
  )
  expect(screen.getByText('No upcoming events right now.')).toBeInTheDocument()
  expect(screen.queryByText('Merch')).not.toBeInTheDocument()
})
it('does not advertise an available price when sold out', () => {
  render(
    <MemoryRouter>
      <StorefrontView
        data={{
          ...storefrontFixture,
          featured: {
            ...storefrontFixture.featured!,
            admission: {
              state: 'sold_out',
              minimumAmountMinor: null,
              currency: null,
            },
          },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByText('Sold Out')).toBeInTheDocument()
  expect(screen.queryByText(/From \$/)).not.toBeInTheDocument()
})
it('hands paid buyers to existing tier selection, never direct checkout', () => {
  render(
    <MemoryRouter>
      <StorefrontView data={storefrontFixture} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Get Tickets' })).toHaveAttribute(
    'href',
    `/events/${storefrontFixture.featured!.id}/tickets`,
  )
  expect(screen.getByRole('link', { name: 'View Event Details' }))
    .toHaveAttribute('href', `/events/${storefrontFixture.featured!.id}`)
})
it('hands free attendees to the existing RSVP route', () => {
  render(
    <MemoryRouter>
      <StorefrontView
        data={{
          ...storefrontFixture,
          featured: { ...storefrontFixture.featured!, admissionType: 'free' },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'RSVP' })).toHaveAttribute(
    'href',
    `/events/${storefrontFixture.featured!.id}/rsvp`,
  )
})
it('sold-out events have no transaction CTA', () => {
  render(
    <MemoryRouter>
      <StorefrontView
        data={{
          ...storefrontFixture,
          featured: {
            ...storefrontFixture.featured!,
            admission: {
              state: 'sold_out',
              minimumAmountMinor: null,
              currency: null,
            },
          },
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('link', { name: 'Get Tickets' })).not
    .toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View Event Details' }))
    .toBeInTheDocument()
})
it.each([0, 1, 3])(
  'renders %i bounded merch cards as external links',
  (count) => {
    const merch = Array.from({ length: count }, (_, i) => ({
      id: `24000000-0000-4000-8000-00000000003${i}`,
      imageId: '24000000-0000-4000-8000-000000000011',
      title: `Merch ${i}`,
      price: null,
      url: `https://shop.example.org/item${i}`,
    }))
    render(
      <MemoryRouter>
        <StorefrontView data={{ ...storefrontFixture, merch }} />
      </MemoryRouter>,
    )
    expect(screen.queryAllByRole('link', { name: /Merch \d/ })).toHaveLength(
      count,
    )
    for (const link of screen.queryAllByRole('link', { name: /Merch \d/ })) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(screen.queryByText(/shipping|add to cart/i)).not.toBeInTheDocument()
  },
)

it('uses section anchors only for populated sections and keeps public links safe', () => {
  render(
    <MemoryRouter>
      <StorefrontView
        data={{
          ...storefrontFixture,
          identity: {
            ...storefrontFixture.identity,
            links: {
              instagram: 'https://instagram.com/night-sessions',
              soundcloud: 'https://soundcloud.com/night-sessions',
            },
            websiteUrl: 'https://example.org',
          },
        }}
      />
    </MemoryRouter>,
  )
  const navigation = screen.getByRole('navigation', {
    name: 'Storefront sections',
  })
  expect(navigation.querySelector('a[href="#storefront-events"]'))
    .toBeInTheDocument()
  expect(navigation.querySelector('a[href="#storefront-about"]'))
    .toBeInTheDocument()
  expect(navigation.querySelector('a[href="#storefront-merch"]')).toBeNull()
  expect(screen.queryByRole('link', { name: /SoundCloud/i })).not
    .toBeInTheDocument()
  for (const link of screen.getAllByRole('link', { name: 'Instagram' })) {
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  }
})
it('keeps upcoming event details accessible through the title alongside the canonical CTA', () => {
  render(
    <MemoryRouter>
      <StorefrontView
        data={{
          ...storefrontFixture,
          featured: null,
          events: [storefrontFixture.featured!],
        }}
      />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'A night of live music' }))
    .toHaveAttribute('href', `/events/${storefrontFixture.featured!.id}`)
  expect(screen.getByRole('link', { name: 'Get Tickets' })).toHaveAttribute(
    'href',
    `/events/${storefrontFixture.featured!.id}/tickets`,
  )
})
