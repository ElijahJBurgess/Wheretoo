import { lazy, Suspense } from 'react'
import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Field } from '../../components/ui/Field'
import type { EventFormValues, NormalizedLocation } from './event.types'

const LocationSearchField = lazy(() => import('./LocationSearchField'))

type EventScheduleLocationStepProps = {
  errors: FieldErrors<EventFormValues>
  location: NormalizedLocation | null
  onLocationChange: (location: NormalizedLocation | null) => void
  creation?: boolean
  register: UseFormRegister<EventFormValues>
}

export function EventScheduleLocationStep({ errors, location, onLocationChange, register, creation = false }: EventScheduleLocationStepProps) {
  const Heading = creation ? 'h1' : 'h2'
  return (
    <div className="event-step">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 2</p>
        <Heading>{creation ? 'Date & Location' : 'Set the moment and place'}</Heading>
        <p>Times are shown in Los Angeles time. Select a verified address for publishing.</p>
      </header>
      <div className="event-step__fields event-step__fields--schedule">
        <Field error={errors.startsAt?.message} label="Starts" name="startsAt">
          <input type="datetime-local" {...register('startsAt')} />
        </Field>
        <Field error={errors.endsAt?.message} label="Ends" name="endsAt">
          <input type="datetime-local" {...register('endsAt')} />
        </Field>
        <p className="event-timezone">America/Los_Angeles</p>
        <Field error={errors.venueName?.message} label="Venue name" name="venueName">
          <input maxLength={160} placeholder="Civic Center Plaza" {...register('venueName')} />
        </Field>
        <Suspense fallback={<p role="status">Loading address search…</p>}>
          <LocationSearchField error={errors.location?.message} onChange={onLocationChange} value={location} />
        </Suspense>
      </div>
    </div>
  )
}
