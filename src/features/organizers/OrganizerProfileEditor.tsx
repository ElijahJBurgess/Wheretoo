import { useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { OnboardingLayout, OnboardingProgress } from '../organizer-onboarding/OnboardingLayout'
import { UnsavedSettingsGuard } from '../organizer-settings/UnsavedSettingsGuard'
import { StorefrontMedia } from '../storefront/StorefrontMedia'
import { isValidHandle, normalizeHandle } from '../storefront/storefront.handle'
import { clearUnusedOrganizerMedia, confirmIdentity, handleAvailable, readIdentity, uploadOrganizerMedia } from '../storefront/storefront.identity.api'
import { validateImageSelection } from '../event-images/imageFiles'
import { getOrganizer } from './organizer.api'
import { saveProfile } from './profile.api'
import { organizerInputSchema, type OrganizerInput } from './organizer.schemas'

async function loadProfile(userId: string, current: () => boolean) {
  const organizer = await getOrganizer(userId)
  if (!current()) throw new Error('Your session changed.')
  const identity = organizer ? await readIdentity() : null
  if (!current()) throw new Error('Your session changed.')
  if (organizer && !identity) throw new Error('Your organizer profile could not load. Try again.')
  return { organizer, identity }
}
type Profile = Awaited<ReturnType<typeof loadProfile>>
const message = (error: unknown) => error instanceof Error ? error.message : 'Your profile could not be saved. Try again.'

export function OrganizerProfileEditor({ settings = false }: { settings?: boolean }) {
  const session = useSession()
  const signOut = useOptionalSignOut()
  if (session.status !== 'authenticated' || signOut?.pending) return <p role='status'>Loading your organizer profile…</p>
  return <ProfileLoader key={`${session.user.id}:${session.identityVersion ?? 0}`} userId={session.user.id} metadataName={session.user.user_metadata?.full_name} settings={settings} />
}
function ProfileLoader({ userId, metadataName, settings }: { userId: string; metadataName: unknown; settings: boolean }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['organizer-settings', 'profile-identity', userId],
    queryFn: () => loadProfile(userId, captureIdentityLifetime(client, userId)),
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false,
  })
  const content = query.isPending ? <AsyncState status='loading' title='Loading your organizer profile' />
    : query.isError ? <AsyncState status='error' title='Your organizer profile could not load' description={message(query.error)} action={<Button onClick={() => void query.refetch()}>Try again</Button>} />
      : <ProfileForm userId={userId} initial={query.data} metadataName={metadataName} settings={settings} />
  return settings ? <section className='settings-panel profile-editor'>{content}</section>
    : <OnboardingLayout title='Organizer Profile'><div className='profile-editor'>{content}{(query.isPending || query.isError) && <Link to='/discover'>Exit setup</Link>}</div></OnboardingLayout>
}
function ProfileForm({ userId, initial, metadataName, settings }: { userId: string; initial: Profile; metadataName: unknown; settings: boolean }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const live = useRef(false)
  const latch = useRef(false)
  const errorFocus = useRef<HTMLDivElement>(null)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const [saved, setSaved] = useState(initial)
  const [version, setVersion] = useState(initial.organizer?.updated_at ?? null)
  const [logoId, setLogoId] = useState(initial.identity?.logoId ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [handle, setHandle] = useState(initial.identity?.handle ?? '')
  const [claimed, setClaimed] = useState(initial.identity?.handle ?? null)
  const [confirmed, setConfirmed] = useState(false)
  const [availability, setAvailability] = useState<{ handle: string; value: boolean | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [latest, setLatest] = useState<Profile | null>(null)
  const { register, handleSubmit, control, reset, formState: { errors, isDirty } } = useForm<OrganizerInput>({
    resolver: zodResolver(organizerInputSchema),
    defaultValues: {
      displayName: initial.organizer?.display_name ?? (typeof metadataName === 'string' ? metadataName : ''),
      organizerType: initial.organizer?.organizer_type ?? '', bio: initial.organizer?.bio ?? '',
      websiteUrl: initial.organizer?.website_url ?? '', baseCity: initial.organizer?.base_city ?? '',
    },
  })
  const name = useWatch({ control, name: 'displayName' })
  const dirty = isDirty || !!file || logoId !== saved.identity?.logoId && !!logoId
  const conflict = error.includes('changed elsewhere')
  const exitTo = saved.organizer?.onboarding_completed_at || claimed ? '/organizer/events' : '/discover'
  const url = `${window.location.origin}/${handle}`
  useEffect(() => {
    if (claimed || !isValidHandle(handle)) return
    let active = true
    const current = captureIdentityLifetime(client, userId)
    const timer = setTimeout(() => {
      void handleAvailable(handle).then(value => { if (active && current()) setAvailability({ handle, value }) })
        .catch(() => { if (active && current()) setAvailability({ handle, value: null }) })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [handle, claimed, client, userId])
  useEffect(() => { if (error) errorFocus.current?.focus() }, [error])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function lifetime() { const current = captureIdentityLifetime(client, userId); return () => live.current && current() }
  function exit() {
    if (busy) return
    if (!dirty || window.confirm('Leave setup without saving your changes?')) navigate(exitTo)
  }
  async function save(input: OrganizerInput, action: 'continue' | 'leave' | 'save') {
    if (latch.current || conflict) return
    const shouldClaim = !claimed && (action === 'continue' || (action === 'save' && confirmed))
    setError(''); setNotice('')
    if (shouldClaim && (!isValidHandle(handle) || !confirmed || availability?.handle === handle && availability.value === false)) {
      setError('Choose an available handle and confirm your permanent URL before continuing.'); return
    }
    latch.current = true; setBusy(true)
    const current = lifetime()
    try {
      let image = logoId
      if (file) {
        image = await uploadOrganizerMedia(file, userId, current)
        if (!current()) return
        setLogoId(image); setFile(null)
      }
      const result = await saveProfile(userId, input, version, image, current)
      if (!current()) return
      setVersion(result.updatedAt)
      reset(input)
      // Keep the draft version even if the subsequent permanent claim fails.
      setSaved(previous => ({ ...previous, identity: { name: input.displayName, handle: claimed, logoId: image } }))
      if (shouldClaim) {
        const identity = await confirmIdentity(handle, image, userId, current)
        if (!current()) return
        setClaimed(identity.handle)
      }
      await client.invalidateQueries({ predicate: query => ['organizer', 'organizer-settings', 'public-storefront', 'events', 'organizer-operations', 'moderation', 'public-ticketing'].includes(String(query.queryKey[0])) })
      if (!current()) return
      // Cleanup is best effort after attachment, never before the new logo is saved.
      if (image) void clearUnusedOrganizerMedia(userId, current).catch(() => { /* Existing cleanup can be retried from Storefront settings. */ })
      if (action === 'continue') navigate('/organizer/settings/payments', { state: { organizerSetup: true } })
      else if (action === 'leave') navigate(exitTo)
      else {
        const fresh = await loadProfile(userId, current)
        if (!current()) return
        setVersion(fresh.organizer?.updated_at ?? null); setSaved(fresh)
        setLogoId(fresh.identity?.logoId ?? null)
        setClaimed(fresh.identity?.handle ?? null)
        if (fresh.identity?.handle) setHandle(fresh.identity.handle)
        reset({ displayName: fresh.organizer?.display_name ?? input.displayName,
          organizerType: fresh.organizer?.organizer_type ?? '', bio: fresh.organizer?.bio ?? '',
          websiteUrl: fresh.organizer?.website_url ?? '', baseCity: fresh.organizer?.base_city ?? '' })
        setNotice('Organizer profile saved.')
      }
    } catch (failure) { if (current()) setError(message(failure)) }
    finally { latch.current = false; if (current()) setBusy(false) }
  }
  async function reviewLatest() {
    const current = lifetime()
    try { const value = await loadProfile(userId, current); if (current()) setLatest(value) }
    catch (failure) { if (current()) setNotice(message(failure)) }
  }
  return <section className='onboarding-form onboarding-form--profile' aria-labelledby='organizer-profile-title'>
    {settings && <UnsavedSettingsGuard dirty={dirty} />}
    {!settings && <OnboardingProgress step={2} />}
    <h1 id='organizer-profile-title' className={settings ? undefined : 'onboarding__sr-only'}>Organizer Profile</h1>
    <form className='auth-form settings-form' noValidate onSubmit={event => { void handleSubmit(input => save(input, settings ? 'save' : 'continue'), () => setError(''))(event) }}>
      <div ref={errorFocus} tabIndex={-1}><FormErrorSummary errors={error ? [error] : Object.values(errors).map(value => value.message ?? 'Check your fields.')} title={error ? 'Profile save failed' : 'Check the highlighted fields'} /></div>
      <fieldset disabled={busy} className='profile-editor__group'><legend>Basic information</legend>
        <Field label='Organizer / business name' name='displayName' error={errors.displayName?.message}><input autoComplete='organization' {...register('displayName')} /></Field>
        <Field label='Organizer type' name='organizerType' error={errors.organizerType?.message}><select {...register('organizerType')}><option value=''>Choose a type (optional)</option>{['Venue','Promoter','Restaurant','Community group','Run club','Museum','Business','Event creator'].map(type => <option key={type}>{type}</option>)}</select></Field>
        <Field label='Website or social (optional)' name='websiteUrl' error={errors.websiteUrl?.message}><input autoComplete='url' type='url' placeholder='https://' {...register('websiteUrl')} /></Field>
      </fieldset>
      <fieldset disabled={busy} className='profile-editor__group'><legend>About</legend>
        <Field label='Short description' name='bio' error={errors.bio?.message}><textarea maxLength={500} {...register('bio')} /></Field>
        <Field label='Base city' name='baseCity' error={errors.baseCity?.message}><input autoComplete='address-level2' {...register('baseCity')} /></Field>
      </fieldset>
      <fieldset disabled={busy} className='profile-editor__group'><legend>Brand</legend>
        {logoId && <StorefrontMedia key={logoId} ownerId={userId} id={logoId} alt='Organizer logo' className='profile-editor__logo' />}
        <Field label='Organizer logo / avatar (optional)' name='logo'><input type='file' accept='image/jpeg,image/png,image/webp' onChange={event => {
          const selected = event.target.files?.[0]; if (!selected) return
          try { validateImageSelection([selected], 0); setFile(selected); setError('') } catch (failure) { setError(message(failure)); event.target.value = '' }
        }} /></Field>
        <p className='profile-editor__hint'>{file ? `${file.name} — ready to save` : 'JPEG, PNG or WebP, up to 5 MB.'}</p>
      </fieldset>
      <fieldset disabled={busy} className='profile-editor__group'><legend>Your Wheretoo URL</legend>
        {claimed ? <><a className='profile-editor__url' href={url}>{url}</a><p className='profile-editor__hint'>Your handle is permanent. Changing your organizer name will not change it.</p></> : <>
          <p className='profile-editor__hint' id='handle-help'>Choose the URL people will use to find your organizer page. Your handle becomes permanent once confirmed.</p>
          <Field label='Permanent handle' name='handle'><input value={handle} maxLength={30} autoCapitalize='none' autoCorrect='off' aria-describedby='handle-help handle-status' onChange={event => { setHandle(normalizeHandle(event.target.value)); setConfirmed(false); setAvailability(null) }} /></Field>
          <p className='profile-editor__url'>{url}</p>
          <p id='handle-status' role='status' className='profile-editor__hint'>{handle && !isValidHandle(handle) ? 'Use 3–30 lowercase letters, numbers or single hyphens. Reserved names are unavailable.' : availability?.handle === handle ? availability.value === true ? 'Available. Reserved only after confirmation.' : availability.value === false ? 'This handle is unavailable.' : 'Availability could not be checked. Confirmation will check again.' : 'Choose your handle.'}</p>
          <label className='profile-editor__confirmation'><input type='checkbox' checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I confirm this permanent URL. I cannot change my handle later.</span></label>
        </>}
      </fieldset>
      {saved.organizer?.onboarding_completed_at && name.trim() !== saved.organizer.display_name && <p className='profile-editor__hint'>Changing your public organizer name sends affected events through review again. Existing tickets and orders stay unchanged.</p>}
      {conflict && <div><Button type='button' onClick={() => void reviewLatest()}>Review latest saved profile</Button>{latest && <><p>Latest saved profile: {latest.organizer?.display_name}</p>{latest.identity?.logoId ? <StorefrontMedia key={latest.identity.logoId} id={latest.identity.logoId} ownerId={userId} alt='Latest saved logo' className='profile-editor__logo' /> : <p>No saved logo.</p>}{(file || logoId !== saved.identity?.logoId) && <p>Your selected logo will replace the saved logo when you save.</p>}<p>{latest.organizer?.bio || 'No description'}</p><p>{latest.organizer?.organizer_type} · {latest.organizer?.base_city} · {latest.organizer?.website_url}</p><Button type='button' onClick={() => { setVersion(latest.organizer?.updated_at ?? null); if (!file && logoId === (saved.identity?.logoId ?? null)) setLogoId(latest.identity?.logoId ?? null); setSaved(latest); setClaimed(latest.identity?.handle ?? null); if (latest.identity?.handle) setHandle(latest.identity.handle); setError(''); setLatest(null) }}>Keep my draft for the reviewed version</Button></>}</div>}
      {notice && <p role='status'>{notice}</p>}
      <Button disabled={busy || conflict} type='submit'>{busy ? 'Saving profile…' : settings ? 'Save profile' : 'Continue'}</Button>
      {!settings && <><Button disabled={busy || conflict} variant='secondary' type='button' onClick={() => void handleSubmit(input => save(input, 'leave'))()}>Save & leave</Button><div className='profile-editor__navigation'><button type='button' disabled={busy} onClick={exit}>Back</button><button type='button' disabled={busy} onClick={exit}>Exit setup</button></div></>}
    </form>
  </section>
}
