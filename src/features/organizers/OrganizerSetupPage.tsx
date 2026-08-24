import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import type { Organizer } from './organizer.api'
import { useOrganizer, useSaveOrganizer } from './organizer.queries'
import { organizerInputSchema, type OrganizerInput } from './organizer.schemas'

const organizerTypes = [
  'Venue',
  'Promoter',
  'Restaurant',
  'Community group',
  'Run club',
  'Museum',
  'Business',
  'Event creator',
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Your organizer profile could not be saved. Try again.'
}

function defaultValues(organizer: Organizer | null, metadataName: unknown): OrganizerInput {
  const seededName = typeof metadataName === 'string' ? metadataName : ''

  return {
    displayName: organizer?.display_name ?? seededName,
    organizerType: organizer?.organizer_type ?? '',
    bio: organizer?.bio ?? '',
    websiteUrl: organizer?.website_url ?? '',
    baseCity: organizer?.base_city ?? '',
  }
}

type OrganizerSetupFormProps = {
  initialValues: OrganizerInput
  userId: string
}

function OrganizerSetupForm({ initialValues, userId }: OrganizerSetupFormProps) {
  const navigate = useNavigate()
  const saveOrganizerMutation = useSaveOrganizer(userId)
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<OrganizerInput>({
    resolver: zodResolver(organizerInputSchema),
    defaultValues: initialValues,
  })
  const isSaving = isSubmitting || saveOrganizerMutation.isPending
  const validationMessages = [
    errors.displayName?.message,
    errors.organizerType?.message,
    errors.bio?.message,
    errors.websiteUrl?.message,
    errors.baseCity?.message,
  ].filter((message): message is string => typeof message === 'string')
  const summaryErrors = serverError ? [...validationMessages, serverError] : validationMessages
  const summaryTitle = serverError ? 'Profile save failed' : 'Check the highlighted fields'

  const submit = handleSubmit(async (input) => {
    setServerError(null)

    try {
      await saveOrganizerMutation.mutateAsync(input)
      navigate('/organizer/events', { replace: true })
    } catch (error) {
      setServerError(errorMessage(error))
    }
  })

  return (
    <section aria-labelledby="organizer-setup-title" className="auth-panel">
      <p className="auth-panel__eyebrow">Organizer profile · 1 of 1</p>
      <h1 id="organizer-setup-title">Tell us about your organization</h1>
      <p className="auth-panel__intro">
        Create the public identity people will see beside every event you publish.
      </p>
      <FormErrorSummary errors={summaryErrors} title={summaryTitle} />
      <form className="auth-form" noValidate onSubmit={submit}>
        <Field error={errors.displayName?.message} label="Public organizer name" name="displayName">
          <input autoComplete="organization" {...register('displayName')} />
        </Field>
        <Field error={errors.organizerType?.message} label="Organizer type" name="organizerType">
          <select {...register('organizerType')}>
            <option value="">Choose a type (optional)</option>
            {organizerTypes.map((organizerType) => (
              <option key={organizerType} value={organizerType}>
                {organizerType}
              </option>
            ))}
          </select>
        </Field>
        <Field error={errors.bio?.message} label="Short description" name="bio">
          <textarea maxLength={500} {...register('bio')} />
        </Field>
        <Field error={errors.websiteUrl?.message} label="Website" name="websiteUrl">
          <input autoComplete="url" inputMode="url" placeholder="https://" type="url" {...register('websiteUrl')} />
        </Field>
        <Field error={errors.baseCity?.message} label="Base city" name="baseCity">
          <input autoComplete="address-level2" placeholder="San Francisco" {...register('baseCity')} />
        </Field>
        <Button disabled={isSaving} type="submit">
          {isSaving ? 'Saving profile…' : 'Save organizer profile'}
        </Button>
      </form>
    </section>
  )
}

export function OrganizerSetupPage() {
  const sessionState = useSession()
  const userId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const metadataName =
    sessionState.status === 'authenticated' ? sessionState.user.user_metadata.full_name : undefined
  const organizerQuery = useOrganizer(userId)

  if (sessionState.status !== 'authenticated' || organizerQuery.isPending) {
    return <AsyncState status="loading" title="Loading your organizer profile" />
  }

  if (organizerQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Your organizer profile could not load"
      />
    )
  }

  if (organizerQuery.data?.onboarding_completed_at) {
    return <Navigate replace to="/organizer/events" />
  }

  return (
    <div className="auth-layout__main">
      <OrganizerSetupForm
        initialValues={defaultValues(organizerQuery.data ?? null, metadataName)}
        userId={userId}
      />
    </div>
  )
}
