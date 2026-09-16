import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSession } from '../auth/SessionProvider'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { getOrganizer } from '../organizers/organizer.api'
import { organizerKeys } from '../organizers/organizer.queries'
import { saveSettingsProfile, SettingsProfileError, type SettingsProfile } from './settings.profile.api'
import { UnsavedSettingsGuard } from './UnsavedSettingsGuard'

export function OrganizerProfilePage() {
  const session = useSession()
  const signOut = useOptionalSignOut()
  if (session.status !== 'authenticated' || signOut?.pending) return <p role='status'>Loading organizer profile…</p>
  return <ProfileLoader key={`${session.user.id}:${session.identityVersion ?? 0}`} userId={session.user.id} />
}
function ProfileLoader({ userId }: { userId: string }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['organizer-settings', 'profile', userId],
    queryFn: async () => {
      const current = captureIdentityLifetime(client, userId)
      const row = await getOrganizer(userId)
      if (!current()) throw new Error('Session changed')
      if (!row) throw new Error('Profile unavailable')
      return { displayName: row.display_name, bio: row.bio ?? '', updatedAt: row.updated_at }
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: 'always',
  })
  if (query.isPending) return <p role='status'>Loading organizer profile…</p>
  if (query.isError || !query.data) return <section className='settings-panel'><p role='alert'>Your organizer profile could not load.</p><button className='ops-button' onClick={() => void query.refetch()}>Try again</button></section>
  return <ProfileEditor userId={userId} initial={query.data} />
}
function ProfileEditor({ userId, initial }: { userId: string; initial: SettingsProfile }) {
  const client = useQueryClient()
  const [saved, setSaved] = useState(initial)
  const [name, setName] = useState(initial.displayName)
  const [bio, setBio] = useState(initial.bio)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [latest, setLatest] = useState<SettingsProfile | null>(null)
  const latch = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dirty = name !== saved.displayName || bio !== saved.bio
  const renamed = name.trim() !== saved.displayName
  function lifetime() { const current = captureIdentityLifetime(client, userId); return () => mounted.current && current() }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (latch.current || conflict || !dirty) return
    const current = lifetime()
    latch.current = true; setPending(true); setError(null); setNotice(null)
    try {
      const result = await saveSettingsProfile(userId, { displayName: name, bio, expectedUpdatedAt: saved.updatedAt }, current)
      if (!current()) return
      setSaved(result); setName(result.displayName); setBio(result.bio); setNotice('Organizer profile saved.')
      void client.invalidateQueries({ queryKey: organizerKeys.detail(userId) })
      // Public name edits use the existing revision writer; refresh affected event views.
      void client.invalidateQueries({ predicate: query => ['events', 'organizer-operations', 'moderation', 'public-ticketing'].includes(String(query.queryKey[0])) })
    } catch (failure) {
      if (!current()) return
      setError(failure instanceof SettingsProfileError ? failure.message : 'Your profile could not be saved. Your changes are still here.')
      if (failure instanceof SettingsProfileError && failure.code === 'conflict') setConflict(true)
    } finally { latch.current = false; if (current()) setPending(false) }
  }
  async function reviewLatest() {
    if (latch.current) return
    const current = lifetime(); latch.current = true; setPending(true)
    try {
      const row = await getOrganizer(userId)
      if (!current()) return
      if (!row) throw new Error('Unavailable')
      setLatest({ displayName: row.display_name, bio: row.bio ?? '', updatedAt: row.updated_at })
    } catch { if (current()) setError('The latest profile could not load. Your changes are still here. Try again.') }
    finally { latch.current = false; if (current()) setPending(false) }
  }
  return <div className='settings-stack'>
    <UnsavedSettingsGuard dirty={dirty} />
    <section className='settings-panel'><h2>Organizer Profile</h2><p className='settings-description'>How your organizer appears alongside your events. Your private account name is managed separately.</p>
      <form className='settings-form' onSubmit={event => void save(event)}>
        <label className='ops-field'>Organizer display name<input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={100} disabled={pending} autoComplete='organization' /></label>
        <label className='ops-field'>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} maxLength={500} rows={5} disabled={pending} aria-describedby='profile-bio-count' /></label>
        <span id='profile-bio-count' className='settings-muted'>{bio.length}/500 characters</span>
        {renamed && <p className='settings-notice'>Changing your public organizer name sends affected events through review again. They may be unavailable for public discovery and new sales until approved. Existing tickets, orders and purchase history stay unchanged.</p>}
        {error && <p className='settings-error' role='alert'>{error}</p>}
        {notice && <p className='settings-notice' role='status'>{notice}</p>}
        {conflict && <div className='settings-conflict'><button type='button' className='ops-button ops-button--secondary' disabled={pending} onClick={() => void reviewLatest()}>Review latest saved profile</button>
          {latest && <><h3>Latest saved profile</h3><p>{latest.displayName}</p><p className='settings-bio'>{latest.bio || 'No bio added.'}</p><p>Your draft is still in the fields above. Compare it before continuing.</p><button className='ops-button ops-button--secondary' type='button' onClick={() => { setSaved(latest); setConflict(false); setLatest(null); setError(null); setNotice('Latest version reviewed. Check your draft, then save to apply it.') }}>Keep my draft for the reviewed version</button></>}
        </div>}
        <div className='settings-actions'><button className='ops-button' disabled={pending || !dirty || conflict}>{pending ? 'Saving…' : 'Save profile'}</button><button type='button' className='ops-button ops-button--secondary' disabled={pending || !dirty} onClick={() => { setName(saved.displayName); setBio(saved.bio); setError(null); setNotice(null) }}>Reset changes</button></div>
      </form>
    </section>
    <section className='settings-panel settings-preview' aria-labelledby='profile-preview-title'><p className='settings-eyebrow' id='profile-preview-title'>Profile preview — not a public page</p><div className='settings-identity'><span className='settings-avatar' aria-hidden='true'>{name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'O'}</span><h3>{name.trim() || 'Organizer name'}</h3></div><p className='settings-bio'>{bio || 'Your organizer bio will appear here.'}</p></section>
  </div>
}
