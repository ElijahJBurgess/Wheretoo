import { useLocation } from 'react-router-dom'
import { OnboardingProgress } from '../organizer-onboarding/OnboardingLayout'
import { OrganizerPaymentsPage } from '../payments/OrganizerPaymentsPage'

// Presentation only: retain the existing payout page, guards and Stripe behavior.
export function OrganizerPayoutsRoute() {
  const { state } = useLocation()
  const fromSetup = typeof state === 'object' && state !== null && state.organizerSetup === true
  return <>{fromSetup && <div className='profile-payout-progress'><OnboardingProgress step={3} /></div>}<OrganizerPaymentsPage /></>
}
