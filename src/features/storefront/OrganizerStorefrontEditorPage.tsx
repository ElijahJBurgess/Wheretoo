import type { StorefrontCursor } from './storefront.schemas'
import { StorefrontInsights } from './StorefrontInsights'
import { StorefrontMerchEditor } from './StorefrontMerchEditor'
import './storefront.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useOptionalSignOut } from '../auth/SignOutProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { UnsavedSettingsGuard } from '../organizer-settings/UnsavedSettingsGuard'
import {
  publishStorefront,
  readEditor,
  readPreview,
  saveStorefront,
} from './storefront.editor.api'
import {
  editorInput,
  editorInputSchema,
  socialLabels,
  type StorefrontEditor,
  type StorefrontInput,
} from './storefront.editor'
import {
  clearUnusedOrganizerMedia,
  uploadOrganizerMedia,
} from './storefront.identity.api'
import { StorefrontMedia } from './StorefrontMedia'
export function OrganizerStorefrontEditorPage() {
  const session = useSession()
  const signout = useOptionalSignOut()
  if (session.status !== 'authenticated' || signout?.pending) {
    return <p role='status'>Loading your storefront…</p>
  }
  return (
    <EditorLoader
      key={`${session.user.id}:${session.identityVersion}`}
      userId={session.user.id}
    />
  )
}
function EditorLoader({ userId }: { userId: string }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['organizer-settings', 'storefront', userId],
    queryFn: async () => {
      const current = captureIdentityLifetime(client, userId)
      const value = await readEditor()
      if (!current()) throw new Error('Session changed')
      return value
    },
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
  if (query.isPending) return <p role='status'>Loading settings…</p>
  if (query.isError) {
    return (
      <div>
        <p role='alert'>Storefront settings could not load.</p>
        <button onClick={() => void query.refetch()}>Try again</button>
      </div>
    )
  }
  return <Editor initial={query.data} userId={userId} />
}
function Editor(
  { initial, userId }: { initial: StorefrontEditor; userId: string },
) {
  const client = useQueryClient()
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(() => editorInput(initial))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const latch = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const preview = useInfiniteQuery({
    initialPageParam: null as StorefrontCursor | null,
    queryKey: ['organizer-settings', 'storefront-events', userId],
    queryFn: async ({ pageParam }) => {
      const valid = captureIdentityLifetime(client, userId)
      const value = await readPreview(pageParam, 20)
      if (!valid()) throw new Error('Session changed')
      return value
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    gcTime: 0,
  })
  const [merchState, setMerchState] = useState({ dirty: false, busy: false })
  const merchChanged = useCallback(
    (dirty: boolean, busy: boolean) => setMerchState({ dirty, busy }),
    [],
  )
  const dirty = JSON.stringify(draft) !== JSON.stringify(editorInput(saved))
  const events = [
    ...new Map(
      (preview.data?.pages.flatMap(
        (page) => [...(page.featured ? [page.featured] : []), ...page.events],
      ) ?? []).map((event) => [event.id, event]),
    ).values(),
  ]
  function change<K extends keyof StorefrontInput>(
    key: K,
    value: StorefrontInput[K],
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setNotice('')
  }
  function current() {
    const valid = captureIdentityLifetime(client, userId)
    return () => mounted.current && valid()
  }
  async function write(kind: 'save' | 'publish' | 'unpublish') {
    if (latch.current) return
    const isCurrent = current()
    latch.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (kind === 'save') {
        const parsed = editorInputSchema.safeParse(draft)
        if (!parsed.success) {
          throw new Error(
            parsed.error.issues[0]?.message ?? 'Check your fields.',
          )
        }
      }
      const result = kind === 'save'
        ? await saveStorefront(draft, saved.updatedAt, userId, isCurrent)
        : await publishStorefront(
          kind === 'publish',
          saved.updatedAt,
          userId,
          isCurrent,
        )
      if (!isCurrent()) return
      setSaved(result)
      setDraft(editorInput(result))
      setNotice(
        kind === 'save'
          ? 'Storefront saved.'
          : kind === 'publish'
          ? 'Storefront published.'
          : 'Storefront unpublished.',
      )
      void client.invalidateQueries({
        predicate: (query) =>
          ['public-storefront', 'public-ticketing', 'events', 'organizer']
            .includes(String(query.queryKey[0])),
      })
      void preview.refetch()
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : 'Save failed.')
      }
    } finally {
      latch.current = false
      if (isCurrent()) setBusy(false)
    }
  }
  async function upload(file: File | undefined, field: 'logoId' | 'coverId') {
    if (!file || latch.current) return
    const isCurrent = current()
    latch.current = true
    setBusy(true)
    setError('')
    try {
      const id = await uploadOrganizerMedia(file, userId, isCurrent)
      if (isCurrent()) change(field, id)
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : 'Upload failed.')
      }
    } finally {
      latch.current = false
      if (isCurrent()) setBusy(false)
    }
  }
  return (
    <div className='settings-stack storefront-editor'>
      <UnsavedSettingsGuard dirty={dirty || merchState.dirty} />
      <section className='settings-panel'>
        <h2>Organizer Storefront</h2>
        <p>Your permanent home for events.</p>
        {saved.handle
          ? <p>@{saved.handle} · Your handle cannot change.</p>
          : (
            <p>
              <Link to='/organizer/settings/profile'>
                Complete your organizer profile
              </Link>
            </p>
          )}
        <form
          className='settings-form'
          onSubmit={(event) => {
            event.preventDefault()
            void write('save')
          }}
        >
          <label className='ops-field'>
            Display name<input
              value={draft.name}
              maxLength={100}
              disabled={merchState.busy || busy}
              onChange={(event) => change('name', event.target.value)}
            />
          </label>
          {draft.name.trim() !== saved.name
            ? (
              <p role='status'>
                Changing your name sends your events through their existing
                publication review. They may temporarily disappear from your
                storefront.
              </p>
            )
            : null}
          <label className='ops-field'>
            Short description<textarea
              rows={4}
              value={draft.bio ?? ''}
              maxLength={500}
              disabled={merchState.busy || busy}
              onChange={(event) => change('bio', event.target.value || null)}
            />
          </label>
          <label className='ops-field'>
            Home city<input
              value={draft.city ?? ''}
              maxLength={120}
              disabled={merchState.busy || busy}
              onChange={(event) => change('city', event.target.value || null)}
            />
          </label>
          <label className='ops-field'>
            Logo / avatar<input
              type='file'
              accept='image/jpeg,image/png,image/webp'
              disabled={merchState.busy || busy}
              onChange={(event) =>
                void upload(event.target.files?.[0], 'logoId')}
            />
          </label>
          {draft.logoId
            ? (
              <StorefrontMedia
                key={draft.logoId}
                id={draft.logoId}
                alt='Saved logo'
                className='storefront-editor-image'
                ownerId={userId}
              />
            )
            : null}
          <label className='ops-field'>
            Cover image (optional)<input
              type='file'
              accept='image/jpeg,image/png,image/webp'
              disabled={merchState.busy || busy}
              onChange={(event) =>
                void upload(event.target.files?.[0], 'coverId')}
            />
          </label>
          {draft.coverId
            ? (
              <>
                <StorefrontMedia
                  key={draft.coverId}
                  id={draft.coverId}
                  alt='Cover preview'
                  className='storefront-editor-image'
                  ownerId={userId}
                />
                <button
                  type='button'
                  disabled={merchState.busy || busy}
                  onClick={() => change('coverId', null)}
                >
                  Remove cover
                </button>
              </>
            )
            : null}
          <label className='ops-field'>
            Accent<select
              value={draft.accent ?? ''}
              disabled={merchState.busy || busy}
              onChange={(event) => change(
                'accent',
                (event.target.value || null) as StorefrontInput['accent'],
              )}
            >
              <option value=''>Wheretoo default</option>
              {['violet', 'blue', 'rose', 'amber'].map((color) => (
                <option key={color}>{color}</option>
              ))}
            </select>
          </label>
          <label className='ops-field'>
            Website<input
              type='url'
              value={draft.websiteUrl ?? ''}
              maxLength={500}
              disabled={merchState.busy || busy}
              onChange={(event) =>
                change('websiteUrl', event.target.value || null)}
            />
          </label>
          {Object.entries(socialLabels).map(([key, label]) => (
            <label className='ops-field' key={key}>
              {label}
              <input
                type='url'
                value={draft.links[key] ?? ''}
                disabled={merchState.busy || busy}
                onChange={(event) => {
                  const links = { ...draft.links }
                  if (event.target.value) {
                    links[key] = event.target.value
                  } else delete links[key]
                  change('links', links)
                }}
              />
            </label>
          ))}
          <label className='ops-field'>
            Featured event<select
              value={draft.featuredEventId ?? ''}
              disabled={merchState.busy || busy}
              onChange={(event) =>
                change('featuredEventId', event.target.value || null)}
            >
              <option value=''>Automatic — earliest eligible event</option>
              {draft.featuredEventId &&
                  !events.some((event) => event.id === draft.featuredEventId)
                ? (
                  <option value={draft.featuredEventId}>
                    Previously selected event (currently unavailable)
                  </option>
                )
                : null}
              {events.map((event) => (
                <option key={event.id} value={event.id}>{event.title}</option>
              ))}
            </select>
          </label>
          {preview.hasNextPage
            ? (
              <button
                type='button'
                disabled={preview.isFetchingNextPage}
                onClick={() => void preview.fetchNextPage()}
              >
                Load more event choices
              </button>
            )
            : null}
          {preview.isError
            ? (
              <p role='status'>
                Event choices could not load.{' '}
                <button type='button' onClick={() => void preview.refetch()}>
                  Retry events
                </button>
              </p>
            )
            : null}
          {error
            ? (
              <div role='alert'>
                <p>{error}</p>
                <button
                  type='button'
                  disabled={merchState.busy || busy}
                  onClick={() => {
                    const isCurrent = current()
                    void readEditor().then((value) => {
                      if (isCurrent()) {
                        setSaved(value)
                        setError(
                          'Latest saved version loaded. Your draft is retained; review it before saving.',
                        )
                      }
                    }).catch(() => setError('Latest settings could not load.'))
                  }}
                >
                  Review latest saved version
                </button>
              </div>
            )
            : null}
          {notice ? <p role='status'>{notice}</p> : null}
          <button
            className='ops-button'
            disabled={merchState.busy || busy || !dirty}
            type='submit'
          >
            {busy ? 'Saving…' : 'Save storefront'}
          </button>
        </form>
      </section>
      <section className='settings-panel'>
        <h3>Publication</h3>
        <p>
          {saved.status === 'published'
            ? 'Your storefront is public.'
            : 'Your storefront is unpublished.'}
        </p>
        <p>
          Publication requires your confirmed handle, name, logo, and at least
          one eligible public event.
        </p>
        <div className='settings-actions'>
          <button
            className='ops-button'
            disabled={merchState.busy || merchState.dirty || busy || dirty}
            onClick={() => void write(
              saved.status === 'published' ? 'unpublish' : 'publish',
            )}
          >
            {saved.status === 'published'
              ? 'Unpublish storefront'
              : 'Publish storefront'}
          </button>
          <Link to='/organizer/settings/storefront/preview'>
            Preview saved storefront
          </Link>
          {saved.status === 'published' && saved.handle
            ? <Link to={`/${saved.handle}`}>View public storefront</Link>
            : null}
        </div>
        {dirty
          ? <p>Save your changes before publishing or previewing them.</p>
          : null}
      </section>
      <StorefrontMerchEditor
        saved={saved}
        userId={userId}
        onSaved={setSaved}
        onStateChange={merchChanged}
        disabled={busy}
      />
      <section className='settings-panel'>
        <button
          className='ops-button'
          type='button'
          disabled={busy || dirty || merchState.dirty || merchState.busy}
          onClick={() => {
            const isCurrent = current()
            setBusy(true)
            void clearUnusedOrganizerMedia(userId, isCurrent).then(() => {
              if (isCurrent()) setNotice('Unused uploads cleared.')
            }).catch(() => {
              if (isCurrent()) setError('Unused uploads could not be cleared.')
            }).finally(() => {
              if (isCurrent()) setBusy(false)
            })
          }}
        >
          Clear unused uploads
        </button>
        <p>Save your drafts first. Images used by your storefront are kept.</p>
      </section>
      <StorefrontInsights userId={userId} />
    </div>
  )
}
