// Small presentation-only icons; no external asset or icon-package requests.
const paths = {
  calendar: 'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z',
  pin:
    'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  external:
    'M14 3h7v7m0-7L10 14M10 5H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6',
  share: 'M12 15V2m-4 4 4-4 4 4M7 10H4v12h16V10h-3',
  instagram:
    'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17.5 6.5h.01',
  tiktok: 'M14 3v13a5 5 0 1 1-5-5M14 3c1 4 3 5 7 5M18 8v3a10 10 0 0 1-4-2',
  x: 'M4 3h4l12 18h-4L4 3ZM20 3l-7 8m-2 3-7 7',
  youtube:
    'M21 7c-.2-2-2-2-9-2S3.2 5 3 7c-.5 3-.5 7 0 10 .2 2 2 2 9 2s8.8 0 9-2c.5-3 .5-7 0-10ZM10 9l5 3-5 3V9Z',
  website:
    'm9 15 6-6M7 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 0 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
} as const
export function StorefrontIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className='storefront-icon'
      aria-hidden='true'
      focusable='false'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d={paths[name]} />
    </svg>
  )
}
