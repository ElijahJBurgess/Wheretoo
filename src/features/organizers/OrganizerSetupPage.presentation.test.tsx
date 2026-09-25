import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { OnboardingProgress } from '../organizer-onboarding/OnboardingLayout'
it('represents exactly Account, Profile, Payouts with Profile current', () => { render(<OnboardingProgress step={2} />); const steps = screen.getAllByRole('listitem'); expect(steps).toHaveLength(3); expect(steps[0]).toHaveTextContent('Account complete'); expect(steps[1]).toHaveAttribute('aria-current', 'step'); expect(steps[2]).toHaveTextContent('Payouts') })
