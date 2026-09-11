import { useState } from 'react'

// Event artwork is decorative here; operational identity stays in real text.
// Failed or unsupported stored URLs never turn into invented event photography.
export function EventArtwork({ source, className, eager = false }: {
  source: string | null
  className: string
  eager?: boolean
}) {
  const [failed, setFailed] = useState<string | null>(null)
  let url: string | null = null
  try {
    if (source && new URL(source).protocol === 'https:') url = source
  } catch { /* An unsupported storage path uses the same neutral fallback. */ }
  const available = url !== null && failed !== url
  return <span className={className} aria-hidden='true' data-artwork-state={available ? 'available' : 'missing'}>
    {available ? <img src={url!} alt='' loading={eager ? 'eager' : 'lazy'} decoding='async' referrerPolicy='no-referrer' onError={() => setFailed(url)} /> :
      <svg className='ops-artwork-placeholder' viewBox='0 0 32 32' fill='none' stroke='currentColor' strokeWidth='1.2'>
        <rect x='4' y='4' width='24' height='24' rx='4' /><circle cx='12' cy='12' r='2' /><path d='m5 24 8-8 5 5 4-4 5 5' />
      </svg>}
  </span>
}
