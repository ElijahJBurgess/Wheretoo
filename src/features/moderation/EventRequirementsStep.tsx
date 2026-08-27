import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { Field } from '../../components/ui/Field'
import type { EventRequirementsInput } from './moderation.types'

export type OrganizerRequirementsFormValues = EventRequirementsInput & {
  organizerAgreement: boolean
}

type EventRequirementsStepProps = {
  control: Control<OrganizerRequirementsFormValues>
  errors: FieldErrors<OrganizerRequirementsFormValues>
  onRequirementChange?: () => void
  register: UseFormRegister<OrganizerRequirementsFormValues>
}

const disclosures = [
  ['alcoholPresent', 'Alcohol present'],
  ['cannabisPresent', 'Cannabis present'],
  ['explicitAdultContent', 'Nudity or explicit sexual content'],
  ['gamblingPresent', 'Gambling or wagering'],
  ['weaponsPresent', 'Weapons present or featured'],
  ['highRiskActivity', 'High-risk physical activity'],
] as const

export function EventRequirementsStep({ control, errors, onRequirementChange, register }: EventRequirementsStepProps) {
  return (
    <section aria-labelledby="event-requirements-title" className="event-step event-requirements">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 4</p>
        <h2 id="event-requirements-title">Event details and requirements</h2>
        <p>Add the age requirement and a few clear disclosures for this event.</p>
      </header>
      <div aria-label="Event requirements" className="event-requirements__grid" role="region">
        <Field error={errors.minimumAge?.message} label="Minimum age" name="minimumAge">
          <select {...register('minimumAge', { onChange: onRequirementChange })}>
            <option value="all_ages">All ages</option>
            <option value="18_plus">18+</option>
            <option value="21_plus">21+</option>
          </select>
        </Field>
        {disclosures.map(([name, label]) => {
          const descriptionId = `${name}-description`
          return (
            <fieldset className="event-disclosure" key={name}>
              <legend id={descriptionId}>{label}</legend>
              <div className="event-disclosure__choices">
                <Controller
                  control={control}
                  name={name}
                  render={({ field }) => (
                    <>
                      <label>
                        <input
                          aria-describedby={descriptionId}
                          checked={field.value === true}
                          name={field.name}
                          onBlur={field.onBlur}
                          onChange={() => {
                            field.onChange(true)
                            onRequirementChange?.()
                          }}
                          ref={field.ref}
                          type="radio"
                          value="true"
                        />
                        <span>Yes</span>
                      </label>
                      <label>
                        <input
                          aria-describedby={descriptionId}
                          checked={field.value === false}
                          name={field.name}
                          onBlur={field.onBlur}
                          onChange={() => {
                            field.onChange(false)
                            onRequirementChange?.()
                          }}
                          type="radio"
                          value="false"
                        />
                        <span>No</span>
                      </label>
                    </>
                  )}
                />
              </div>
              {errors[name]?.message ? <p className="ui-field__error" role="alert">{errors[name]?.message}</p> : null}
            </fieldset>
          )
        })}
      </div>
    </section>
  )
}
