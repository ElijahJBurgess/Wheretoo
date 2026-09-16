import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Field } from '../../components/ui/Field'
import { eventCategories } from './event.types'
import type { EventFormValues } from './event.types'

const categoryLabels: Record<(typeof eventCategories)[number], string> = {
  food_drink: 'Food & drink', music: 'Music', fitness: 'Fitness', art_culture: 'Art & culture',
  shopping: 'Shopping', community: 'Community', nightlife: 'Nightlife', other: 'Other',
}

type EventDetailsStepProps = {
  errors: FieldErrors<EventFormValues>
  creation?: boolean
  register: UseFormRegister<EventFormValues>
}

export function EventDetailsStep({ errors, register, creation = false }: EventDetailsStepProps) {
  const Heading = creation ? 'h1' : 'h2'
  return (
    <div className="event-step">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 1</p>
        <Heading>{creation ? 'Event Basics' : 'Give the event a clear shape'}</Heading>
        <p>Start with the public basics. Every field can stay in draft until you are ready.</p>
      </header>
      <div className="event-step__fields">
        <Field error={errors.title?.message} label={creation ? 'Event name' : 'Event title'} name="title">
          <input maxLength={120} placeholder="Neighborhood night market" {...register('title')} />
        </Field>
        <Field error={errors.description?.message} label="Description" name="description">
          <textarea maxLength={5000} placeholder="Tell people what makes this worth showing up for." {...register('description')} />
        </Field>
        <Field error={errors.category?.message} label="Category" name="category">
          <select {...register('category')}>
            <option value="">Choose a category</option>
            {eventCategories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}
          </select>
        </Field>
        {!creation ? <><fieldset className="event-choice-group">
          <legend>Admission</legend>
          <label><input type="radio" value="free" {...register('admissionType')} /><span><strong>Free</strong><small>Ready for this milestone</small></span></label>
          <label><input type="radio" value="paid" {...register('admissionType')} /><span><strong>Paid</strong><small>Set ticket tiers after saving this draft</small></span></label>
        </fieldset>
        <Field error={errors.capacity?.message} label="Capacity (optional)" name="capacity">
          <input min="1" inputMode="numeric" type="number" {...register('capacity', { setValueAs: (value) => value === '' || value === null || value === undefined ? null : Number(value) })} />
        </Field></> : null}
      </div>
    </div>
  )
}
