import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'

export function CheckEmailPage() {
  return (
    <AuthLayout>
      <section aria-labelledby="check-email-title" className="auth-panel">
        <p className="auth-panel__eyebrow">One more step</p>
        <h1 id="check-email-title">Check your email</h1>
        <p className="auth-panel__intro">
          Use the confirmation link we sent to finish creating your organizer account.
        </p>
        <p className="auth-panel__alternate">Already confirmed? <Link to="/auth/sign-in">Sign in</Link></p>
      </section>
    </AuthLayout>
  )
}
