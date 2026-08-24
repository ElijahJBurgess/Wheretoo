import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { signInOrganizer } from './auth.api'
import { signInSchema, type SignInInput } from './auth.schemas'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sign in failed. Try again.'
}

export function SignInPage() {
  const navigate = useNavigate()
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
      navigate('/organizer/events')
    } catch (error) {
      setServerError(errorMessage(error))
    }
  })

  return (
    <AuthLayout>
      <section aria-labelledby="signin-title" className="auth-panel">
        <p className="auth-panel__eyebrow">Organizer access</p>
        <h1 id="signin-title">Sign in</h1>
        <p className="auth-panel__intro">Continue building and publishing your events.</p>
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
        <p className="auth-panel__alternate">New to Whereto? <Link to="/auth/sign-up">Create organizer account</Link></p>
      </section>
    </AuthLayout>
  )
}
