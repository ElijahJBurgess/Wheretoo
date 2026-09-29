import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { EventCreationLayout } from './EventCreationLayout'
import { draftPayload, eventRowToFormValues } from './event.api'
import { testEvent } from '../event-changes/eventChanges.fixtures'

it.each([1,2,3,4,5,6,7,8])('groups internal stage %s in four visible stages', step => {
  render(<MemoryRouter><EventCreationLayout title="Create event" step={step} /></MemoryRouter>)
  const nav = within(screen.getByRole('navigation', { name: 'Event creation progress' }))
  expect(nav.getAllByRole('listitem')).toHaveLength(4)
  for (const name of ['Details','When & Where','Admission','Review']) expect(nav.getByText(name)).toBeVisible()
})
it('preserves exact untouched saved timestamps and canonical location while converting changed times', () => {
  const saved = { ...testEvent, starts_at: '2027-11-07T09:30:17.123Z', ends_at: '2027-11-07T11:00:21.456Z' }
  const values = eventRowToFormValues(saved)
  expect(draftPayload(values, saved)).toMatchObject({ starts_at: saved.starts_at, ends_at: saved.ends_at, mapbox_feature_id: saved.mapbox_feature_id, latitude: saved.latitude, longitude: saved.longitude, address_line1: saved.address_line1 })
  expect(draftPayload({ ...values, startsAt: '2027-11-07T03:00' }, saved).starts_at).toBe('2027-11-07T11:00:00.000Z')
})
