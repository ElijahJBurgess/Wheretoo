import { StorefrontIcon } from './StorefrontIcon'
import { useState } from 'react'
import { shareStorefront } from './storefront.share'
export function StorefrontShare(
  { handle, name }: { handle: string; name: string },
) {
  const [state, setState] = useState('')
  const url = `${window.location.origin}/${encodeURIComponent(handle)}`
  return (
    <div className='storefront-share'>
      <button onClick={() => void shareStorefront(url, name).then(setState)}>
        <StorefrontIcon name='share' />Share
      </button>
      {state === 'copied'
        ? <span role='status'>Link copied</span>
        : state === 'manual'
        ? (
          <label>
            Copy this link<input
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )
        : null}
    </div>
  )
}
