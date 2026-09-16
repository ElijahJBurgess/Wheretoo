import { Link, Navigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { OnboardingIcon } from '../organizer-onboarding/OnboardingLayout'
import { SessionProvider, useSession } from './SessionProvider'

function CheckEmailContent() {
  const sessionState = useSession()
  if (sessionState.status === 'authenticated') return <Navigate replace to="/organizer/setup" />

  return (
    <AuthLayout>
      <section aria-labelledby="check-email-title" className="onboarding-status onboarding-status--pending">
        <div className="onboarding-status__symbol"><OnboardingIcon kind="mail" /></div>
        <p className="onboarding__eyebrow">One more step</p>
        <h1 id="check-email-title">Check your email</h1>
        <p className="onboarding__intro">
          Use the confirmation link we sent to finish creating your organizer account.
        </p>
        <p className="onboarding__alternate">Already confirmed? <Link to="/auth/sign-in">Sign in</Link></p>
      </section>
    </AuthLayout>
  )
}
export function CheckEmailPage() {
  return <SessionProvider><CheckEmailContent /></SessionProvider>
}
