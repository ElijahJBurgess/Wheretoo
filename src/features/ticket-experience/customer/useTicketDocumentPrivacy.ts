import { useEffect } from 'react'

export function useTicketDocumentPrivacy() {
  useEffect(() => {
    const existingMeta = document.head.querySelector<HTMLMetaElement>('meta[name="referrer"]')
    const meta = existingMeta ?? document.createElement('meta')
    const previousContent = existingMeta?.getAttribute('content') ?? null

    if (!existingMeta) {
      meta.name = 'referrer'
      document.head.append(meta)
    }
    meta.content = 'no-referrer'

    return () => {
      if (!existingMeta) {
        meta.remove()
      } else if (previousContent === null) {
        meta.removeAttribute('content')
      } else {
        meta.content = previousContent
      }
    }
  }, [])
}
