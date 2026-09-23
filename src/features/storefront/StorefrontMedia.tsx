import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase/client'
import { organizerMediaUrl } from './storefront.identity.api'
export function StorefrontMedia(
  { id, alt, className, ownerId, loading }: {
    id: string
    alt: string
    className: string
    ownerId?: string
    loading?: 'eager' | 'lazy'
  },
) {
  const [privateUrl, setPrivateUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!ownerId) return
    let active = true
    let objectUrl: string | undefined
    const controller = new AbortController()
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!active || data.session?.user.id !== ownerId) return
        const response = await fetch(organizerMediaUrl(id), {
          headers: { authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        })
        if (!response.ok) return
        const blob = await response.blob()
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setPrivateUrl(objectUrl)
      } catch { /* Keep the safe image placeholder on read failure. */ }
    })()
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, ownerId])
  const url = ownerId ? privateUrl : organizerMediaUrl(id)
  return url
    ? <img className={className} src={url} alt={alt} loading={loading} />
    : <span className={className} role='img' aria-label={alt} />
}
