import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { signInOrganizer } from './auth.api'
import { signInSchema, type SignInInput } from './auth.schemas'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sign in failed. Try again.'
}

function signInDestination(state: unknown): string {
  const fallback = '/organizer/events'
  if (!state || typeof state !== 'object' || !('from' in state)) return fallback
  const from = state.from
  if (!from || typeof from !== 'object') return fallback
  const pathname = 'pathname' in from ? from.pathname : undefined
  const search = 'search' in from ? from.search : ''
  const hash = 'hash' in from ? from.hash : ''
  if (typeof pathname !== 'string' || !/^\/(organizer|moderation)(?:\/|$)/.test(pathname)
    || typeof search !== 'string' || (search !== '' && !search.startsWith('?'))
    || typeof hash !== 'string' || (hash !== '' && !hash.startsWith('#'))) return fallback

  try {
    const origin = 'https://whereto.invalid'
    const target = new URL(`${pathname}${search}${hash}`, origin)
    // Require canonical internal components: normalization must not turn a
    // saved path into an external URL or escape its protected route namespace.
    if (target.origin !== origin || target.pathname !== pathname || target.search !== search || target.hash !== hash) return fallback
    return `${pathname}${search}${hash}`
  } catch {
    return fallback
  }
}

export function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
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
      navigate(signInDestination(location.state), { replace: true })
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
        <FormErrorSummary errors={serverError ? [serverError] : []} title="Sign in failed" />
        <form className="auth-form" noValidate onSubmit={submit}>
          <Field error={errors.email?.message} label="Email" name="email">
            <input autoComplete="email" inputMode="email" type="email" {...register('email')} />
          </Field>
          <Field error={errors.password?.message} label="Password" name="password">
            <input autoComplete="current-password" type="password" {...register('password')} />
          </Field>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="onboarding__alternate">New to wheretoo? <Link to="/auth/sign-up">Create organizer account</Link></p>
      </section>
    </AuthLayout>
  )
}
