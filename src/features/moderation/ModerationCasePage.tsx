import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { useStaffContext } from './staffContext'
import { ModerationApiError } from './moderation.api'
import { useModerationCase, useResolveLegacyPublicHistory, useSubmitModerationAction } from './moderation.queries'
import type { LegacyHistoryResolutionInput, ModerationActionInput, ModerationCase } from './moderation.types'

type StaffAction = ModerationActionInput['action']
type ReasonCode = ModerationActionInput['reasonCode']
type HistoryStatus = LegacyHistoryResolutionInput['publicHistoryStatus']
type EvidenceCode = LegacyHistoryResolutionInput['evidenceCode']

const actionLabels: Record<StaffAction, string> = {
  clear: 'Clear', hold: 'Hold', block: 'Block', remove: 'Remove', restore: 'Restore',
}
const reasonOptions: ReadonlyArray<{ label: string; value: ReasonCode }> = [
  { label: 'No violation', value: 'no_violation' },
  { label: 'Adult explicit content', value: 'adult_explicit' },
  { label: 'Weapons', value: 'weapons' },
  { label: 'Gambling', value: 'gambling' },
  { label: 'Hate or extremism', value: 'hate_extremism' },
  { label: 'Scam or misleading', value: 'scam_misleading' },
  { label: 'Unsafe activity', value: 'unsafe_activity' },
  { label: 'Invalid location', value: 'location_invalid' },
  { label: 'Age mismatch', value: 'age_mismatch' },
  { label: 'Disclosure mismatch', value: 'disclosure_mismatch' },
  { label: 'User report', value: 'user_report' },
  { label: 'Other', value: 'other' },
]
const reasonLabels = new Map(reasonOptions.map((option) => [option.value, option.label]))
const caseDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles',
})

function formatDate(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? 'Time unavailable' : caseDateFormatter.format(instant)
}

function statusLabel(status: ModerationCase['moderationStatus']): string {
  return status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function historyLabel(status: ModerationCase['publicHistoryStatus']): string {
  if (status === 'never_public') return 'Never public'
  if (status === 'previously_public') return 'Previously public'
  return 'History unresolved'
}

function availableActions(moderationStatus: ModerationCase['moderationStatus'], historyStatus: ModerationCase['publicHistoryStatus']): StaffAction[] {
  if (historyStatus === 'unknown') return []
  if (moderationStatus === 'removed') return historyStatus === 'previously_public' ? ['restore'] : []
  if (moderationStatus === 'blocked') return historyStatus === 'never_public' ? ['clear'] : []
  if (moderationStatus === 'under_review') {
    return historyStatus === 'never_public' ? ['clear', 'hold', 'block'] : ['clear', 'hold', 'remove']
  }
  if (moderationStatus === 'not_evaluated') return historyStatus === 'never_public' ? ['clear', 'hold', 'block'] : ['clear', 'hold']
  if (moderationStatus === 'clear') return historyStatus === 'never_public' ? ['hold', 'block'] : ['hold', 'remove']
  return []
}

function disclosureRows(disclosures: ModerationCase['disclosures']) {
  return [
    ['Minimum age', disclosures.minimumAge.replaceAll('_', ' ')],
    ['Alcohol present', disclosures.alcoholPresent ? 'Yes' : 'No'],
    ['Cannabis present', disclosures.cannabisPresent ? 'Yes' : 'No'],
    ['Explicit adult content', disclosures.explicitAdultContent ? 'Yes' : 'No'],
    ['Gambling present', disclosures.gamblingPresent ? 'Yes' : 'No'],
    ['Weapons present', disclosures.weaponsPresent ? 'Yes' : 'No'],
    ['High-risk activity', disclosures.highRiskActivity ? 'Yes' : 'No'],
  ] as const
}

function observedInstant(value: string): string | null {
  if (value === '') return null
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
}

export function ModerationCasePage() {
  const { eventId = '' } = useParams()
  const { role, staffUserId } = useStaffContext()
  const caseQuery = useModerationCase(staffUserId, eventId)
  const organizerId = caseQuery.data?.organizerId ?? ''
  const actionMutation = useSubmitModerationAction(staffUserId, organizerId)
  const historyMutation = useResolveLegacyPublicHistory(staffUserId, organizerId)
  const [selectedAction, setSelectedAction] = useState<StaffAction | ''>('')
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')
  const [internalNote, setInternalNote] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus | ''>('')
  const [evidenceCode, setEvidenceCode] = useState<EvidenceCode | ''>('')
  const [observedPublicAt, setObservedPublicAt] = useState('')
  const [historyNote, setHistoryNote] = useState('')
  const attemptRef = useRef(false)
  const reloadButtonRef = useRef<HTMLButtonElement>(null)
  const feedbackRef = useRef<HTMLParagraphElement>(null)
  const caseHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (hasConflict) reloadButtonRef.current?.focus()
  }, [hasConflict])

  useEffect(() => {
    if (feedback !== null) feedbackRef.current?.focus()
  }, [feedback])

  const actions = useMemo(
    () => caseQuery.data ? availableActions(caseQuery.data.moderationStatus, caseQuery.data.publicHistoryStatus) : [],
    [caseQuery.data],
  )

  if (caseQuery.isPending) return <ReadState headingAs="h1" paused={caseQuery.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading moderation case" />
  if (caseQuery.isError) {
    return <ReadState headingAs="h1" action={<Button onClick={() => void caseQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="unavailable" title="Moderation case could not load" />
  }
  if (caseQuery.data === null || caseQuery.data === undefined) {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to="/moderation">Back to queue</Link>} description="The event may no longer exist or may not be available to staff." status="unavailable" title="Moderation case unavailable" />
  }

  const currentCase = caseQuery.data
  const mutationPending = actionMutation.isPending || historyMutation.isPending

  function handleMutationError(error: unknown) {
    setFeedback(null)
    if (error instanceof ModerationApiError && error.code === 'CONFLICT') {
      setHasConflict(true)
      setErrorMessage('Case changed while you were reviewing it. Reload the latest version before another action.')
      return
    }
    setErrorMessage('The moderation action could not be recorded. Try again.')
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedAction === '' || reasonCode === '' || attemptRef.current || mutationPending || hasConflict) return
    attemptRef.current = true
    setErrorMessage(null)
    setFeedback(null)
    try {
      await actionMutation.mutateAsync({
        eventId: currentCase.eventId,
        expectedContentRevision: currentCase.contentRevision,
        expectedInputSha256: currentCase.inputSha256,
        expectedModerationVersion: currentCase.moderationVersion,
        action: selectedAction,
        reasonCode,
        internalNote,
      })
      setSelectedAction('')
      setReasonCode('')
      setInternalNote('')
      setFeedback(`${actionLabels[selectedAction]} recorded. Current case facts reloaded.`)
    } catch (error) {
      handleMutationError(error)
    } finally {
      attemptRef.current = false
    }
  }

  async function submitHistoryResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (historyStatus === '' || evidenceCode === '' || attemptRef.current || mutationPending || hasConflict) return
    const observedAt = historyStatus === 'never_public' ? null : observedInstant(observedPublicAt)
    if (historyStatus === 'previously_public' && observedAt === null) return
    attemptRef.current = true
    setErrorMessage(null)
    setFeedback(null)
    try {
      await historyMutation.mutateAsync({
        eventId: currentCase.eventId,
        expectedContentRevision: currentCase.contentRevision,
        expectedInputSha256: currentCase.inputSha256,
        expectedModerationVersion: currentCase.moderationVersion,
        publicHistoryStatus: historyStatus,
        evidenceCode,
        observedPublicAt: observedAt,
        internalNote: historyNote,
      })
      setHistoryStatus('')
      setEvidenceCode('')
      setObservedPublicAt('')
      setHistoryNote('')
      setFeedback('Legacy history resolved. The event remains under review for a separate decision.')
    } catch (error) {
      handleMutationError(error)
    } finally {
      attemptRef.current = false
    }
  }

  async function reloadCase() {
    await caseQuery.refetch()
    actionMutation.reset()
    historyMutation.reset()
    setHasConflict(false)
    setErrorMessage(null)
    setFeedback(null)
    setSelectedAction('')
    setReasonCode('')
    caseHeadingRef.current?.focus()
  }

  const evidenceOptions: ReadonlyArray<{ label: string; value: EvidenceCode }> = historyStatus === 'never_public'
    ? [{ label: 'Archive verified never public', value: 'legacy_archive_verified_never_public' }]
    : [
        { label: 'Archive verified public', value: 'legacy_archive_verified_public' },
        { label: 'Legacy server prior-public record', value: 'legacy_server_prior_public' },
      ]

  return (
    <article aria-labelledby="moderation-case-title" className="moderation-case">
      <header className="moderation-case__masthead">
        <div>
          <Link className="moderation-case__back" to="/moderation">← Moderation queue</Link>
          <p className="organizer-eyebrow">Current staff case</p>
          <h1 id="moderation-case-title" ref={caseHeadingRef} tabIndex={-1}>{currentCase.title}</h1>
          <p>{currentCase.venueName} · {currentCase.city}, {currentCase.region}</p>
        </div>
        <span className={`moderation-state moderation-state--${currentCase.moderationStatus}`}>{statusLabel(currentCase.moderationStatus)}</span>
      </header>

      <div className="moderation-case__facts" aria-label="Current case facts">
        <span>Revision {currentCase.contentRevision}</span>
        <span>Moderation version {currentCase.moderationVersion}</span>
        <span>{historyLabel(currentCase.publicHistoryStatus)}</span>
        <span>{currentCase.currentReportCount} {currentCase.currentReportCount === 1 ? 'report' : 'reports'}</span>
        {currentCase.currentOpenReviewRequest ? <span>Review requested</span> : null}
      </div>

      {feedback ? <p className="moderation-case__feedback" ref={feedbackRef} role="status" tabIndex={-1}>{feedback}</p> : null}
      {errorMessage ? (
        <div className="moderation-case__error" role="alert">
          <p>{errorMessage}</p>
          {hasConflict ? <Button onClick={() => void reloadCase()} ref={reloadButtonRef} variant="secondary">Reload case</Button> : null}
        </div>
      ) : null}

      <div className="moderation-case__grid">
        <div className="moderation-case__record">
          <section aria-labelledby="case-summary-title" className="moderation-panel">
            <h2 id="case-summary-title">Current event revision</h2>
            <p>{currentCase.description}</p>
            <dl className="moderation-case__summary">
              <div><dt>Category</dt><dd>{currentCase.category}</dd></div>
              <div><dt>Schedule</dt><dd>{formatDate(currentCase.startsAt)} – {formatDate(currentCase.endsAt)}</dd></div>
              <div><dt>Location</dt><dd>{currentCase.addressLine1}{currentCase.addressLine2 ? `, ${currentCase.addressLine2}` : ''}, {currentCase.city}, {currentCase.region} {currentCase.postalCode}</dd></div>
              <div><dt>Coordinates</dt><dd>{currentCase.latitude}, {currentCase.longitude}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="case-disclosures-title" className="moderation-panel">
            <h2 id="case-disclosures-title">Structured disclosures</h2>
            <dl className="moderation-case__disclosures">
              {disclosureRows(currentCase.disclosures).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>

          <section aria-labelledby="case-evaluations-title" className="moderation-panel">
            <h2 id="case-evaluations-title">Evaluation signals</h2>
            {currentCase.evaluations.length === 0 ? <p>No evaluation signals recorded.</p> : (
              <ul className="moderation-case__evaluations">
                {currentCase.evaluations.map((evaluation) => (
                  <li key={evaluation.id}>
                    <div><strong>{statusLabel(evaluation.status as ModerationCase['moderationStatus'])}</strong><span>Revision {evaluation.content_revision}</span></div>
                    <p>{evaluation.reason_codes.length ? evaluation.reason_codes.map((reason) => reasonLabels.get(reason) ?? 'Other').join(', ') : 'No curated reasons'}</p>
                    <small>{formatDate(evaluation.created_at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="case-timeline-title" className="moderation-panel moderation-timeline">
            <h2 id="case-timeline-title">Action timeline</h2>
            {currentCase.actions.length === 0 ? <p>No prior staff actions.</p> : (
              <ol>
                {currentCase.actions.map((action) => (
                  <li key={action.id}>
                    <div><strong>{action.action.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())}</strong><span>{formatDate(action.created_at)}</span></div>
                    <p>{statusLabel(action.previous_status)} → {statusLabel(action.new_status)} · {reasonLabels.get(action.reason_code) ?? 'Other'}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside aria-label="Case actions" className="moderation-case__actions">
          {currentCase.publicHistoryStatus === 'unknown' ? (
            role === 'admin' ? (
              <form className="moderation-panel moderation-decision" onSubmit={(event) => void submitHistoryResolution(event)}>
                <header>
                  <p className="organizer-eyebrow">Admin only</p>
                  <h2>Resolve legacy history</h2>
                  <p>Record bounded evidence only. This does not clear the event.</p>
                </header>
                <fieldset>
                  <legend>Verified history</legend>
                  <label><input checked={historyStatus === 'never_public'} disabled={mutationPending || hasConflict} name="history-status" onChange={() => { setHistoryStatus('never_public'); setEvidenceCode(''); setObservedPublicAt('') }} type="radio" value="never_public" /> Never public</label>
                  <label><input checked={historyStatus === 'previously_public'} disabled={mutationPending || hasConflict} name="history-status" onChange={() => { setHistoryStatus('previously_public'); setEvidenceCode('') }} type="radio" value="previously_public" /> Previously public</label>
                </fieldset>
                {historyStatus ? (
                  <label className="ui-field">
                    <span className="ui-field__label">Evidence</span>
                    <select disabled={mutationPending || hasConflict} onChange={(event) => setEvidenceCode(event.target.value as EvidenceCode | '')} value={evidenceCode}>
                      <option value="">Select evidence</option>
                      {evidenceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                ) : null}
                {historyStatus === 'previously_public' ? (
                  <label className="ui-field">
                    <span className="ui-field__label">Observed public at</span>
                    <input disabled={mutationPending || hasConflict} onChange={(event) => setObservedPublicAt(event.target.value)} type="datetime-local" value={observedPublicAt} />
                  </label>
                ) : null}
                <label className="ui-field">
                  <span className="ui-field__label">Internal note (optional)</span>
                  <textarea disabled={mutationPending || hasConflict} maxLength={1000} onChange={(event) => setHistoryNote(event.target.value)} value={historyNote} />
                </label>
                <Button disabled={historyStatus === '' || evidenceCode === '' || (historyStatus === 'previously_public' && observedPublicAt === '') || mutationPending || hasConflict} type="submit">
                  {historyMutation.isPending ? 'Resolving…' : 'Resolve history'}
                </Button>
              </form>
            ) : (
              <section className="moderation-panel">
                <h2>History resolution required</h2>
                <p>An admin must record verified legacy evidence before a separate moderation decision can be made.</p>
              </section>
            )
          ) : (
            <form className="moderation-panel moderation-decision" onSubmit={(event) => void submitAction(event)}>
              <header>
                <p className="organizer-eyebrow">Exact revision decision</p>
                <h2>Moderation action</h2>
                <p>The server rechecks revision, digest, and moderation version before recording an action.</p>
              </header>
              <fieldset className="moderation-decision__actions">
                <legend>Decision</legend>
                <div>
                  {actions.map((action) => (
                    <label key={action}>
                      <input checked={selectedAction === action} disabled={mutationPending || hasConflict} name="staff-action" onChange={() => setSelectedAction(action)} type="radio" value={action} />
                      <span>{actionLabels[action]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="ui-field">
                <span className="ui-field__label">Reason</span>
                <select disabled={mutationPending || hasConflict} onChange={(event) => setReasonCode(event.target.value as ReasonCode | '')} required value={reasonCode}>
                  <option value="">Select a reason</option>
                  {reasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="ui-field">
                <span className="ui-field__label">Internal note (optional)</span>
                <textarea disabled={mutationPending || hasConflict} maxLength={1000} onChange={(event) => setInternalNote(event.target.value)} value={internalNote} />
              </label>
              <Button disabled={selectedAction === '' || reasonCode === '' || mutationPending || hasConflict} type="submit">
                {actionMutation.isPending ? 'Recording…' : selectedAction ? `Apply ${actionLabels[selectedAction]}` : 'Choose an action'}
              </Button>
            </form>
          )}
        </aside>
      </div>
    </article>
  )
}
