import { Link } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { useStaffContext } from './staffContext'
import { useModerationQueue } from './moderation.queries'
import type { ModerationQueueItem } from './moderation.types'

const queueDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Los_Angeles',
})

function formatQueuedAt(value: string | null): string {
  if (value === null) return 'No active evaluation'
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? 'Queue time unavailable' : `Waiting since ${queueDateFormatter.format(instant)}`
}

function statusLabel(status: ModerationQueueItem['moderationStatus']): string {
  switch (status) {
    case 'under_review': return 'Under review'
    case 'blocked': return 'Blocked'
    case 'removed': return 'Removed'
    case 'clear': return 'Clear'
    case 'not_evaluated': return 'Not evaluated'
  }
}

export function ModerationQueuePage() {
  const { staffUserId } = useStaffContext()
  const queueQuery = useModerationQueue(staffUserId)

  if (queueQuery.isPending) {
    return <ReadState headingAs="h1" paused={queueQuery.fetchStatus === 'paused'} status="loading" skeleton="order-rows" title="Loading moderation queue" />
  }

  if (queueQuery.isError || !Array.isArray(queueQuery.data)) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void queueQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Moderation queue could not load"
      />
    )
  }

  if (!queueQuery.data?.length) {
    return (
      <ReadState headingAs="h1"
        description="Held, blocked, and removed events will appear here when staff attention is needed."
        status="empty"
        title="No cases need attention"
      />
    )
  }

  return (
    <section aria-labelledby="moderation-queue-title" className="moderation-queue">
      <header className="moderation-queue__header">
        <div>
          <p className="organizer-eyebrow">Staff console</p>
          <h1 id="moderation-queue-title">Moderation queue</h1>
          <p>Review current server-prioritized cases and act only on the version shown.</p>
        </div>
        <strong>{queueQuery.data.length} active {queueQuery.data.length === 1 ? 'case' : 'cases'}</strong>
      </header>
      <ol className="moderation-queue__list">
        {queueQuery.data.map((item) => (
          <li key={item.eventId}>
            <Link aria-label={`Open moderation case ${item.eventId}`} to={`/moderation/events/${item.eventId}`}>
              <span className={`moderation-state moderation-state--${item.moderationStatus}`}>
                {statusLabel(item.moderationStatus)}
              </span>
              <span className="moderation-queue__identity">
                <strong>Case {item.eventId.slice(0, 8)}</strong>
                <code>{item.eventId}</code>
              </span>
              <span className="moderation-queue__signals">
                {item.currentOpenReviewRequest ? <span>Review requested</span> : null}
                <span>{item.currentReportCount} {item.currentReportCount === 1 ? 'report' : 'reports'}</span>
                <span>{item.queuedEvaluationCount} active {item.queuedEvaluationCount === 1 ? 'evaluation' : 'evaluations'}</span>
              </span>
              <span className="moderation-queue__time">{formatQueuedAt(item.oldestQueuedAt)}</span>
              <span aria-hidden="true" className="moderation-queue__arrow">→</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
