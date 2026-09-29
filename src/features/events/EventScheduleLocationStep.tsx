import { lazy, Suspense } from 'react'
import type { Control, FieldErrors, UseFormRegister } from 'react-hook-form'
import { EventDateTimeField } from './EventDateTimeField'
import './eventSchedule.css'
import { Field } from '../../components/ui/Field'
import type { EventFormValues, NormalizedLocation } from './event.types'

const LocationSearchField = lazy(() => import('./LocationSearchField'))

type EventScheduleLocationStepProps = {
  control: Control<EventFormValues>
  errors: FieldErrors<EventFormValues>
  location: NormalizedLocation | null
  onLocationChange: (location: NormalizedLocation | null) => void
  creation?: boolean
  register: UseFormRegister<EventFormValues>
}

export function EventScheduleLocationStep({ control, errors, location, onLocationChange, register, creation = false }: EventScheduleLocationStepProps) {
  const Heading = creation ? 'h1' : 'h2'
  return (
    <div className="event-step">
      <header className="event-step__header">
        <Heading>When &amp; Where</Heading>
        <p>Pacific Time</p>
      </header>
      <div className="event-step__fields event-step__fields--schedule">
        <EventDateTimeField control={control} name="startsAt" label="Start" />
        <EventDateTimeField control={control} name="endsAt" label="End" />
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
