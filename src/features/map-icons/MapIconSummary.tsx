import { useOwnedMapIcon, useSelectableMapIcons } from './icon.catalog.queries'

export function MapIconSummary({ organizerId, eventId, value }: { organizerId: string; eventId?: string; value: string | null }) {
  if (value === null) return <div className="map-icon-summary"><strong>Map Icon</strong><span>Default</span></div>
  return <AssignedIconSummary organizerId={organizerId} eventId={eventId} value={value} />
}

function AssignedIconSummary({ organizerId, eventId, value }: { organizerId: string; eventId?: string; value: string }) {
  const catalog = useSelectableMapIcons(organizerId, value !== null)
  const owned = useOwnedMapIcon(organizerId, eventId, value !== null)
  const option = catalog.data?.pages.flatMap(page => page.icons).find(icon => icon.versionId === value)
  const assignment = owned.data?.versionId === value ? owned.data : null
  const icon = option ?? assignment?.descriptor
  return <div className="map-icon-summary"><strong>Map Icon</strong>
    {icon ? <img src={icon.url} alt="" width="36" height="56" /> : null}
    <span>{value === null ? 'Default' : option?.name ?? assignment?.name ?? 'Saved icon'}</span>
    {value && assignment?.state === 'revoked' ? <small>Unavailable artwork — normal marker shown.</small> : null}
  </div>
}
