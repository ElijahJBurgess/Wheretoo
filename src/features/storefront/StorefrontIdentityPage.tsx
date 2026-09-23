import { useQueryClient } from '@tanstack/react-query'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { OnboardingLayout } from '../organizer-onboarding/OnboardingLayout'
import { isValidHandle, normalizeHandle } from './storefront.handle'
import {
  confirmIdentity,
  handleAvailable,
  readIdentity,
  uploadOrganizerMedia,
} from './storefront.identity.api'
export function StorefrontIdentityPage() {
  const session = useSession()
  if (session.status !== 'authenticated') {
    return <p role='status'>Sign in to complete organizer setup.</p>
  }
  return (
    <IdentityForm
      key={`${session.user.id}:${session.identityVersion}`}
      userId={session.user.id}
    />
  )
}
function IdentityForm({ userId }: { userId: string }) {
  const client = useQueryClient()
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const navigate = useNavigate()
  const [handle, setHandle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [savedHandle, setSavedHandle] = useState<string | null>(null)
  const [logoId, setLogoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void readIdentity().then((value) => {
      if (active && value) {
        setHandle(value.handle ?? '')
        setSavedHandle(value.handle)
        setLogoId(value.logoId)
      }
    }).catch(() => {
      if (active) setError('Your identity could not load. Reload to try again.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      if (isValidHandle(handle) && !savedHandle) {
        void handleAvailable(handle).then((value) => {
          if (active) setAvailable(value)
        }).catch(() => {
          if (active) setAvailable(null)
        })
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [handle, savedHandle])
  const url = `${window.location.origin}/${handle}`
  return (
    <OnboardingLayout title='Organizer identity'>
      <section className='onboarding-form'>
        <h1>Your permanent organizer identity</h1>
        <p>
          Add your logo and choose the address people will use to find your
          events.
        </p>
        {loading ? <p role='status'>Loading identity…</p> : (
          <form
            className='auth-form'
            onSubmit={(event) => {
              event.preventDefault()
              if (busy) return
              setError('')
              if (
                !isValidHandle(handle) || (!confirmed && !savedHandle) ||
                (!file && !logoId)
              ) {
                setError(
                  'Choose a valid handle, add your logo, and confirm your permanent URL.',
                )
                return
              }
              const current = captureIdentityLifetime(client, userId)
              setBusy(true)
              void (async () => {
                try {
                  const image = file
                    ? await uploadOrganizerMedia(
                      file,
                      userId,
                      () => live.current && current(),
                    )
                    : logoId!
                  if (!live.current || !current()) {
                    return
                  }
                  setLogoId(image)
                  setFile(null)
                  await confirmIdentity(handle, image, userId)
                  if (!live.current || !current()) {
                    return
                  }
                  await client.invalidateQueries({
                    queryKey: ['organizer', userId],
                  })
                  if (!live.current || !current()) return
                  navigate('/organizer/settings/payments', { replace: true })
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Identity could not be saved.',
                  )
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            <label>
              Permanent handle<input
                value={handle}
                disabled={busy || !!savedHandle}
                maxLength={30}
                autoCapitalize='none'
                autoCorrect='off'
                onChange={(event) => {
                  setHandle(normalizeHandle(event.target.value))
                  setAvailable(null)
                  setConfirmed(false)
                }}
              />
            </label>
            <p>{url}</p>
            {available === false && !savedHandle
              ? <p role='status'>This handle is unavailable.</p>
              : available === true
              ? (
                <p role='status'>
                  This handle is available. It is reserved only after
                  confirmation.
                </p>
              )
              : null}
            <label>
              Organizer logo / avatar<input
                type='file'
                accept='image/jpeg,image/png,image/webp'
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {logoId ? <p>A logo is saved.</p> : null}
            {!savedHandle
              ? (
                <label>
                  <input
                    type='checkbox'
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{' '}
                  I confirm this permanent URL. I cannot change my handle later.
                </label>
              )
              : (
                <p>
                  Your handle is permanent. Changing your organizer name will
                  not change it.
                </p>
              )}
            {error ? <p role='alert'>{error}</p> : null}
            <button
              className='ui-button'
              disabled={busy || available === false}
              type='submit'
            >
              {busy ? 'Saving identity…' : 'Confirm identity and continue'}
            </button>
          </form>
        )}
        <Link to='/organizer/setup'>Back to organizer profile</Link>
      </section>
    </OnboardingLayout>
  )
}
