import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { signInOrganizer } from './auth.api'
import { useOptionalSignOut } from './SignOutProvider'
import { signInSchema, type SignInInput } from './auth.schemas'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sign in failed. Try again.'
}

function validatedReturnDestination(state: unknown): string {
  const fallback = '/organizer/events'
  if (!state || typeof state !== 'object' || !('from' in state)) return fallback
  const from = state.from
  if (!from || typeof from !== 'object' || !('pathname' in from) || typeof from.pathname !== 'string') return fallback
  const path = from.pathname
  // Only registered organizer paths; never restore general query/fragment data.
  if ((path === '/organizer/setup' || path === '/organizer/setup/identity')) return path
  if (/^\/organizer\/settings(?:\/(?:account|profile|payments|help|actions|storefront(?:\/preview)?))?$/.test(path)) {
    const eventId = 'paymentEventId' in state ? state.paymentEventId : undefined
    return path === '/organizer/settings/payments' && typeof eventId === 'string' && z.uuid().safeParse(eventId).success
      ? `${path}?eventId=${eventId}`
      : path
  }
  if (path === '/organizer/events' || path === '/organizer/events/new') return path
  const segments = path.split('/')
  if (segments[0] !== '' || segments[1] !== 'organizer' || segments[2] !== 'events' || !z.uuid().safeParse(segments[3]).success) return fallback
  const tail = segments.slice(4)
  if (tail.length === 0) return path
  if (tail.length === 1 && ['edit', 'preview', 'changes', 'cancellation', 'tickets', 'dashboard', 'orders', 'registrations', 'check-in'].includes(tail[0])) return path
  if (tail.length === 2 && ['orders', 'registrations'].includes(tail[0]) && z.uuid().safeParse(tail[1]).success) return path
  if (tail[0] === 'check-in') {
    if (tail.length === 2 && ['scan', 'find'].includes(tail[1])) return path
    if (tail.length === 5 && tail[1] === 'find' && tail[2] === 'registrations' && tail.slice(3).every(id => z.uuid().safeParse(id).success)) return path
    if (tail.length === 4 && tail[1] === 'find' && tail.slice(2).every(id => z.uuid().safeParse(id).success)) return path
  }
  return fallback
}

export function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const signOutController = useOptionalSignOut()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const submit = handleSubmit(async (input) => {
    setServerError(null)

    try {
      await signInOrganizer(input)
      signOutController?.dismissNotice()
      navigate(validatedReturnDestination(location.state), { replace: true })
    } catch (error) {
      setServerError(errorMessage(error))
    }
  })

  return (
    <AuthLayout>
      <section aria-labelledby="signin-title" className="onboarding-form">
        <p className="onboarding__eyebrow">Welcome back</p>
        <h1 id="signin-title">Sign in</h1>
        <p className="onboarding__intro">Your next great event starts here.</p>
        {signOutController?.notice ? <p role="status">{signOutController.notice}</p> : null}
        <FormErrorSummary errors={serverError ? [serverError] : []} title="Sign in failed" />
        <form className="auth-form" noValidate onSubmit={submit}>
          <Field error={errors.email?.message} label="Email" name="email">
            <input autoComplete="email" inputMode="email" type="email" {...register('email')} />
          </Field>
          <Field error={errors.password?.message} label="Password" name="password">
            <input autoComplete="current-password" type="password" {...register('password')} />
          </Field>
          <Button disabled={isSubmitting || signOutController?.pending} type="submit">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="onboarding__alternate">New to wheretoo? <Link to="/auth/sign-up">Create organizer account</Link></p>
      </section>
    </AuthLayout>
  )
}
