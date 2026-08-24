import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { signUpOrganizer } from './auth.api'
import { signUpSchema, type SignUpInput } from './auth.schemas'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Account creation failed. Try again.'
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '' },
  })

  const submit = handleSubmit(async (input) => {
    setServerError(null)

    try {
      const result = await signUpOrganizer(input)
      navigate(result.needsEmailConfirmation ? '/auth/check-email' : '/organizer/setup')
    } catch (error) {
      setServerError(errorMessage(error))
    }
  })

  return (
    <AuthLayout>
      <section aria-labelledby="signup-title" className="auth-panel">
        <p className="auth-panel__eyebrow">Organizer access</p>
        <h1 id="signup-title">Create organizer account</h1>
        <p className="auth-panel__intro">Start with your account. You’ll set up your public organizer profile next.</p>
        <FormErrorSummary errors={serverError ? [serverError] : []} title="Account creation failed" />
        <form className="auth-form" noValidate onSubmit={submit}>
          <Field error={errors.fullName?.message} label="Full name" name="fullName">
            <input autoComplete="name" {...register('fullName')} />
          </Field>
          <Field error={errors.email?.message} label="Email" name="email">
            <input autoComplete="email" inputMode="email" type="email" {...register('email')} />
          </Field>
          <Field error={errors.password?.message} label="Password" name="password">
            <input autoComplete="new-password" type="password" {...register('password')} />
          </Field>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Creating account…' : 'Create organizer account'}
          </Button>
        </form>
        <p className="auth-panel__alternate">Already have an organizer account? <Link to="/auth/sign-in">Sign in</Link></p>
      </section>
    </AuthLayout>
  )
}
