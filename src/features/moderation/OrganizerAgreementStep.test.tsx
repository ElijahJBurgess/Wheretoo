import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import type { RequiredPolicy } from './moderation.types'
import { OrganizerAgreementStep } from './OrganizerAgreementStep'
import type { OrganizerRequirementsFormValues } from './EventRequirementsStep'

const organizerTerms: RequiredPolicy = {
  policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1',
  stage: 'development_placeholder', publicUrl: '/organizer-terms',
}
const eventPolicy: RequiredPolicy = {
  policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1',
  stage: 'development_placeholder', publicUrl: '/event-policy',
}

function AgreementHarness({
  onAgreementChange = vi.fn(),
  terms = organizerTerms,
}: {
  onAgreementChange?: () => void
  terms?: RequiredPolicy
}) {
  const { formState: { errors }, register } = useForm<OrganizerRequirementsFormValues>({
    defaultValues: {
      minimumAge: 'all_ages', alcoholPresent: false, cannabisPresent: false,
      explicitAdultContent: false, gamblingPresent: false, weaponsPresent: false,
      highRiskActivity: false, organizerAgreement: false,
    },
  })
  return (
    <OrganizerAgreementStep
      error={errors.organizerAgreement?.message}
      eventPolicy={eventPolicy}
      needsAcceptance
      onAgreementChange={onAgreementChange}
      organizerTerms={terms}
      register={register}
    />
  )
}

describe('OrganizerAgreementStep', () => {
  it('renders one required checkbox with exact linked agreement and supporting copy', async () => {
    const user = userEvent.setup()
    const onAgreementChange = vi.fn()
    render(<AgreementHarness onAgreementChange={onAgreementChange} />)

    const checkbox = screen.getByRole('checkbox', {
      name: "I confirm that this event information and the disclosures above are accurate, and I agree to Whereto's Organizer Terms and Event Policy.",
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(checkbox).toBeRequired()
    expect(screen.getByRole('link', { name: 'Organizer Terms' })).toHaveAttribute('href', '/organizer-terms')
    expect(screen.getByRole('link', { name: 'Event Policy' })).toHaveAttribute('href', '/event-policy')
    expect(screen.getByText('Whereto may review, restrict, or remove events that violate these policies. Material event changes may trigger another review.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelector('[class*="scroll"]')).not.toBeInTheDocument()

    checkbox.focus()
    await user.keyboard('[Space]')
    expect(checkbox).toBeChecked()
    expect(onAgreementChange).toHaveBeenCalledOnce()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Organizer Terms' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Event Policy' })).toHaveFocus()
  })

  it('uses a server-returned canonical production URL without rewriting it', () => {
    const productionTerms: RequiredPolicy = {
      ...organizerTerms,
      versionId: 'organizer-terms-v2',
      stage: 'production_approved',
      publicUrl: 'https://policies.whereto.example/organizer-terms/v2',
    }
    render(<AgreementHarness terms={productionTerms} />)

    expect(screen.getByRole('link', { name: 'Organizer Terms' })).toHaveAttribute(
      'href',
      'https://policies.whereto.example/organizer-terms/v2',
    )
  })
})
