import { useBrowserOnline } from '../../app/connectivity/browserConnectivity'
import { AsyncState, type AsyncStateProps } from './AsyncState'

/** For read loading only; never wraps an owning domain's pending or uncertain write. */
export function ReadState(props: AsyncStateProps & { paused?: boolean }) {
  const online = useBrowserOnline()
  const { paused, ...presentation } = props
  if (props.status === 'loading' && (!online || paused)) {
    return <AsyncState {...presentation} status="offline" skeleton={undefined}
      title="Waiting for a connection"
      description="Your browser may be offline. This information has not loaded yet. Check your connection." />
  }
  return <AsyncState {...presentation} />
}
