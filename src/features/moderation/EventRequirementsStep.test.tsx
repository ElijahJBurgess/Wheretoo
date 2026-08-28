import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { EventRequirementsStep, type OrganizerRequirementsFormValues } from './EventRequirementsStep'

const defaults: OrganizerRequirementsFormValues = {
  minimumAge: 'all_ages',
  alcoholPresent: false,
  cannabisPresent: false,
  explicitAdultContent: false,
  gamblingPresent: false,
  weaponsPresent: false,
  highRiskActivity: false,
  organizerAgreement: false,
}

function RequirementsHarness() {
  const { control, formState: { errors }, register } = useForm<OrganizerRequirementsFormValues>({ defaultValues: defaults })
  return <EventRequirementsStep control={control} errors={errors} register={register} />
}

describe('EventRequirementsStep', () => {
  it('renders the approved age choice and six compact yes-or-no disclosures', () => {
    render(<RequirementsHarness />)

    expect(screen.getByLabelText('Minimum age')).toHaveValue('all_ages')
    expect(screen.getByRole('option', { name: 'All ages' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '18+' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '21+' })).toBeInTheDocument()
    expect(screen.getAllByRole('group')).toHaveLength(6)
    expect(screen.getByRole('group', { name: 'Alcohol present' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cannabis present' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Nudity or explicit sexual content' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Gambling or wagering' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Weapons present or featured' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'High-risk physical activity' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(12)
  })

  it('keeps every disclosure control inside one responsive requirements region', () => {
    const { container } = render(<RequirementsHarness />)

    const region = screen.getByRole('region', { name: 'Event requirements' })
    expect(region).toContainElement(screen.getByLabelText('Minimum age'))
    expect(container.querySelector('.event-requirements__grid')).toBeInTheDocument()
  })
})
