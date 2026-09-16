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

  const validationMessages = [
    errors.fullName?.message,
    errors.email?.message,
    errors.password?.message,
  ].filter((message): message is string => typeof message === 'string')
  const summaryErrors = serverError ? [...validationMessages, serverError] : validationMessages

  const submit = handleSubmit(async (input) => {
    setServerError(null)

    try {
      const result = await signUpOrganizer(input)
      navigate(result.needsEmailConfirmation ? '/auth/check-email' : '/organizer/setup')
    } catch (error) {
      setServerError(errorMessage(error))
    }
  }, () => setServerError(null))

  return (
    <AuthLayout hero headerAction={<Link className="onboarding__header-link" to="/auth/sign-in">Log in</Link>}>
      <section aria-labelledby="signup-title" className="onboarding-form onboarding-form--signup">
        <h1 id="signup-title">Create your<br /> organizer account</h1>
        <p className="onboarding__intro">Bring people together.<br />We’ll handle the rest.</p>
        <FormErrorSummary
          errors={summaryErrors}
          title={serverError ? 'Account creation failed' : 'Check the highlighted fields'}
        />
        <form className="auth-form" noValidate onSubmit={submit}>
          <Field error={errors.fullName?.message} label="Full name" name="fullName">
            <input autoComplete="name" placeholder="Your full name" {...register('fullName')} />
          </Field>
          <Field error={errors.email?.message} label="Email" name="email">
            <input autoComplete="email" inputMode="email" placeholder="you@yourcompany.com" type="email" {...register('email')} />
          </Field>
          <Field error={errors.password?.message} label="Password" name="password">
            <input autoComplete="new-password" placeholder="Create a password" type="password" {...register('password')} />
          </Field>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="onboarding__legal">By creating an account, you agree to our <Link to="/organizer-terms">Organizer Terms</Link> and Privacy Policy.</p>
        <p className="onboarding__alternate">Already have an account? <Link to="/auth/sign-in">Log in</Link></p>
      </section>
    </AuthLayout>
  )
}
