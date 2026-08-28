import type { UseFormRegister } from 'react-hook-form'
import type { RequiredPolicy } from './moderation.types'
import type { OrganizerRequirementsFormValues } from './EventRequirementsStep'

type OrganizerAgreementStepProps = {
  error?: string
  eventPolicy: RequiredPolicy
  needsAcceptance: boolean
  onAgreementChange: () => void
  organizerTerms: RequiredPolicy
  register: UseFormRegister<OrganizerRequirementsFormValues>
}

export function OrganizerAgreementStep({
  error,
  eventPolicy,
  needsAcceptance,
  onAgreementChange,
  organizerTerms,
  register,
}: OrganizerAgreementStepProps) {
  const errorId = error ? 'organizerAgreement-error' : undefined
  return (
    <section aria-labelledby="organizer-agreement-title" className="event-step organizer-agreement">
      <header className="event-step__header">
        <p className="organizer-eyebrow">Stage 5</p>
        <h2 id="organizer-agreement-title">Organizer agreement</h2>
        <p>Review the information and disclosures you are about to submit.</p>
      </header>
      <p className="organizer-agreement__status" role="status">
        {needsAcceptance ? 'Agreement required for these changes.' : 'Agreement current for this saved event.'}
      </p>
      <label className="organizer-agreement__check">
        <input
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          required
          type="checkbox"
          {...register('organizerAgreement', { onChange: onAgreementChange })}
        />
        <span>
          I confirm that this event information and the disclosures above are accurate, and I agree to Whereto&apos;s{' '}
          <a href={organizerTerms.publicUrl}>Organizer Terms</a> and{' '}
          <a href={eventPolicy.publicUrl}>Event Policy</a>.
        </span>
      </label>
      {error ? <p className="ui-field__error" id={errorId} role="alert">{error}</p> : null}
      <p className="organizer-agreement__support">
        Whereto may review, restrict, or remove events that violate these policies. Material event changes may trigger another review.
      </p>
    </section>
  )
}
