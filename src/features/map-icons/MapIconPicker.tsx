import { useId } from 'react'
import './map-icon-picker.css'
import { useOwnedMapIcon, useSelectableMapIcons } from './icon.catalog.queries'

type Props = { organizerId: string; eventId?: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean }
export function MapIconPicker({ organizerId, eventId, value, onChange, disabled }: Props) {
  const name = useId()
  const catalog = useSelectableMapIcons(organizerId)
  const current = useOwnedMapIcon(organizerId, eventId, value !== null)
  const pages = catalog.data?.pages ?? []
  const enabled = pages.length > 0 && pages.every(page => page.selectionEnabled)
  const icons = enabled ? [...new Map(pages.flatMap(page => page.icons).map(icon => [icon.versionId, icon])).values()] : []
  const retained = value !== null && !icons.some(icon => icon.versionId === value)
  const currentLabel = current.data?.versionId === value ? current.data.name : 'Current icon'
  const savedChoice = current.data?.versionId === value
  return <fieldset className="map-icon-picker" disabled={disabled}>
    <legend>Map Icon</legend>
    <p>Choose how your event appears on the map.</p>
    <div className="map-icon-picker__options">
      <label><input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} /><span className="map-icon-picker__default" aria-hidden="true">●</span><span>Default</span></label>
      {icons.map(icon => <label key={icon.versionId}><input type="radio" name={name} checked={value === icon.versionId} onChange={() => onChange(icon.versionId)} /><img src={icon.url} alt="" width="48" height="64" loading="lazy" /><span>{icon.name}</span></label>)}
      {retained ? <label><input type="radio" name={name} checked disabled readOnly /><span>{currentLabel} (current choice)</span></label> : null}
    </div>
    {catalog.isPending ? <p role="status">Loading map icons… Your choice is unchanged.</p> : null}
    {catalog.isError ? <p role="status">Map icons couldn’t load. Your choice has not changed. <button type="button" onClick={() => void catalog.refetch()}>Retry map icons</button></p> : null}
    {!catalog.isPending && !catalog.isError && !enabled ? <p>Default markers are currently available.</p> : null}
    {retained && !catalog.isPending && !catalog.isError ? <p role="status">{savedChoice
      ? 'This saved choice is not available for new selections. You can keep it or choose Default. Unavailable artwork uses the normal marker.'
      : current.isPending && eventId ? 'Checking whether this unavailable choice is already saved. Your choice is unchanged.'
      : current.isError && eventId ? <>We couldn’t verify whether this choice is already saved. Your choice is unchanged. <button type="button" onClick={() => void current.refetch()}>Retry saved choice</button></>
      : 'This choice is no longer available. Choose Default or another available icon before saving.'}</p> : null}
    {catalog.hasNextPage ? <button type="button" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>More map icons</button> : null}
  </fieldset>
}
