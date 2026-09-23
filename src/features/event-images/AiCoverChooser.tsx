import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { coverMoods, requestAiCover } from './aiCover.api'
import { mutateCover } from './coverTransport'

type Props = {
  eventId: string
  revision: number | undefined
  latestGenerationId?: string | null
  disabled?: boolean
}
const retryable = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_FAILED',
  'PROVIDER_RATE_LIMIT',
  'STORAGE_FAILED',
  'INVALID_PROVIDER_IMAGE',
])
export function AiCoverChooser(
  { eventId, revision, latestGenerationId, disabled = false }: Props,
) {
  const session = useSession(), client = useQueryClient()
  const [open, setOpen] = useState(false),
    [chosenMood, setMood] = useState<string | null>(null),
    [chosenDirection, setDirection] = useState<string | null>(null)
  const [localId, setLocalId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const mounted = useRef(false),
    lock = useRef(false),
    autoAttempt = useRef(''),
    request = useRef<{ key: string; id: string } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const generationId = localId ?? latestGenerationId
  const queryKey = [
    'event-images',
    'ai-generation',
    session.user?.id,
    session.identityVersion,
    generationId,
  ]
  const currentIdentity = () => {
    const identity = captureIdentityLifetime(client, session.user?.id ?? null)
    return () => mounted.current && identity()
  }
  const query = useQuery({
    queryKey,
    queryFn: () =>
      requestAiCover(
        { action: 'state', generationId: generationId! },
        currentIdentity(),
      ),
    enabled: !!eventId && !!generationId && session.status === 'authenticated',
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.candidates.some((c) =>
          c.status === 'pending' ||
          (c.status === 'failed' &&
            Date.parse(c.retryAfter) > query.state.dataUpdatedAt)
        )
        ? 3_000
        : 40_000,
    retry: false,
  })
  const generation = query.data
  const mood = chosenMood ?? generation?.input.mood ?? 'Editorial'
  const direction = chosenDirection ?? generation?.input.direction ?? ''
  const stale = !!generation &&
    (generation.expectedRevision !== revision || generation.expired ||
      (!!latestGenerationId && latestGenerationId !== generation.id))
  const unavailable = disabled || busy || revision === undefined || !eventId ||
    session.status !== 'authenticated'
  const pending = generation?.candidates.some((c) => c.status === 'pending') ??
    false
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (lock.current || unavailable) return
    lock.current = true
    setBusy(true)
    setError(null)
    const current = currentIdentity()
    try {
      await action(current)
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : 'Covers could not load.')
      }
    } finally {
      lock.current = false
      if (current()) setBusy(false)
    }
  }
  async function step(slot: number, attempt: number) {
    await run(async (current) => {
      const data = await requestAiCover({
        action: 'step',
        generationId: generationId!,
        slot,
        attempt,
      }, current)
      if (current()) client.setQueryData(queryKey, data)
    })
  }
  const next = !stale && !generation?.selectedSlot
    ? generation?.candidates.find((c) =>
      c.status === 'pending' && c.attempts === 0
    )
    : undefined
  // Reopening advances only never-started slots. Lost/in-flight attempts require recovery
  // and an explicit retry, so reload cannot silently bill an extra provider attempt.
  useEffect(() => {
    if (!next || unavailable || error || query.isError) return
    const key = `${generationId}:${next.slot}`
    if (autoAttempt.current === key) return
    autoAttempt.current = key
    void step(next.slot, 0)
  })
  async function start() {
    await run(async (current) => {
      const payload = {
        action: 'start' as const,
        eventId,
        revision: revision!,
        mood,
        direction: direction.trim(),
      }
      const key = JSON.stringify(payload)
      if (request.current?.key !== key) {
        request.current = { key, id: crypto.randomUUID() }
      }
      const data = await requestAiCover({
        ...payload,
        requestId: request.current.id,
      }, current)
      if (!current()) return
      client.setQueryData([
        'event-images',
        'ai-generation',
        session.user?.id,
        session.identityVersion,
        data.id,
      ], data)
      setLocalId(data.id)
      setOpen(true)
      request.current = null
      autoAttempt.current = ''
      await client.invalidateQueries({
        queryKey: ['event-images', 'cover-state'],
      })
    })
  }
  async function select(slot: number) {
    if (!generation || stale) return
    await run(async (current) => {
      await mutateCover(eventId, generation.expectedRevision, {
        generationId: generation.id,
        slot,
      }, current)
      if (current()) {
        await Promise.all([
          client.invalidateQueries({ queryKey: ['event-images'] }),
          client.invalidateQueries({ queryKey: ['public-event-images'] }),
        ])
      }
    })
  }
  return (
    <div className='ai-cover-chooser'>
      <div className='event-image-actions'>
        <button
          type='button'
          disabled={unavailable}
          aria-expanded={open || !!generation}
          onClick={() => setOpen((v) => !v)}
        >
          Generate with AI
        </button>
      </div>
      {!eventId
        ? (
          <p className='event-image-status'>
            Save your event details before generating covers.
          </p>
        )
        : null}
      {open || generation
        ? (
          <div className='ai-cover-controls'>
            <p className='event-image-status'>
              Create three private options from your saved event details. Your
              cover stays the same until you choose one.
            </p>
            <label>
              Mood<select
                aria-label='Mood'
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                disabled={busy}
              >
                {coverMoods.map((value) => <option key={value}>{value}
                </option>)}
              </select>
            </label>
            <label>
              Creative direction <span>(optional)</span>
              <textarea
                aria-label='Creative direction'
                maxLength={300}
                rows={2}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder='For example, warm light and a relaxed neighborhood feel'
                disabled={busy}
              />
            </label>
            <div className='event-image-actions'>
              <button
                type='button'
                disabled={unavailable || (pending && !stale)}
                onClick={() => void start()}
              >
                {generation ? 'Regenerate 3 covers' : 'Generate 3 covers'}
              </button>
            </div>
          </div>
        )
        : null}
      {!!generationId && query.isPending
        ? <p role='status'>Loading private covers…</p>
        : null}
      {pending && !stale
        ? (
          <p role='status'>
            Generating your covers… You can reopen this event to continue.
          </p>
        )
        : null}
      {stale
        ? (
          <p role='status'>
            Your cover changed or these options expired. Generate a new set to
            continue.
          </p>
        )
        : null}
      {generation?.selectedSlot
        ? <p role='status'>Cover {generation.selectedSlot} was selected.</p>
        : null}
      {generation
        ? (
          <div
            className='ai-cover-options'
            aria-label='Private AI cover options'
          >
            {generation.candidates.map((c) => (
              <article
                key={c.id}
                className='ai-cover-option'
                aria-label={`Cover ${c.slot}`}
              >
                <div className='ai-cover-art'>
                  {c.url
                    ? <img src={c.url} alt={`AI cover option ${c.slot}`} />
                    : (
                      <span>
                        {c.status === 'pending'
                          ? 'Generating…'
                          : generation.expired
                          ? 'Expired'
                          : 'Could not generate'}
                      </span>
                    )}
                </div>
                {c.status === 'ready'
                  ? (
                    <div className='event-image-actions'>
                      <button
                        type='button'
                        disabled={unavailable || stale ||
                          !!generation.selectedSlot}
                        onClick={() => void select(c.slot)}
                      >
                        Use this cover
                      </button>
                    </div>
                  )
                  : null}
                {c.status === 'failed' && !generation.expired
                  ? (
                    <>
                      <p className='event-image-status'>
                        {c.failureCode === 'CONTENT_BLOCKED'
                          ? 'Try a different creative direction.'
                          : c.attempts >= 2
                          ? 'Retry used. Generate a new set for another option.'
                          : generation.candidates.some((option) =>
                              option.status === 'ready'
                            )
                          ? 'The other covers are still available.'
                          : 'Try again, or generate a new set.'}
                      </p>
                      {retryable.has(c.failureCode ?? '') && c.attempts < 2
                        ? (
                          <div className='event-image-actions'>
                            <button
                              type='button'
                              disabled={unavailable || stale ||
                                !!generation.selectedSlot ||
                                Date.parse(c.retryAfter) > query.dataUpdatedAt}
                              onClick={() => void step(c.slot, c.attempts)}
                            >
                              Retry cover {c.slot}
                            </button>
                          </div>
                        )
                        : null}
                    </>
                  )
                  : null}
              </article>
            ))}
          </div>
        )
        : null}
      {error || query.isError
        ? (
          <p role='alert'>
            {error ?? 'Private covers could not load.'}{' '}
            <button
              type='button'
              disabled={busy}
              onClick={() => {
                setError(null)
                autoAttempt.current = ''
                void query.refetch()
                void client.invalidateQueries({
                  queryKey: ['event-images', 'cover-state'],
                })
              }}
            >
              Refresh covers
            </button>
          </p>
        )
        : null}
    </div>
  )
}
