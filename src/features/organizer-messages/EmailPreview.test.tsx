import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
vi.mock(
  '../../lib/env',
  () => ({ publicEnv: { supabaseUrl: 'https://safe.example' } }),
)
import { EmailPreview } from './EmailPreview'
test('preserves server hierarchy and text while stripping executable attributes and destinations', () => {
  render(
    <EmailPreview
      html={'<div style="color:red"><h1>Event update</h1><p onclick="bad()">&lt;script&gt;literal&lt;/script&gt;</p><a href="javascript:bad()">View Event</a><img src="https://safe.example/functions/v1/event-images?id=11111111-1111-4111-8111-111111111111" alt="Flyer" onerror="bad()"><img src="https://safe.example/sign/private?token=secret"><script>bad()</script><iframe src="https://evil.example"></iframe></div>'}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Event update' })).toBeVisible()
  expect(screen.getByText('<script>literal</script>')).toBeVisible()
  expect(screen.getByAltText('Flyer')).toBeVisible()
  expect(document.querySelector('script,iframe,[onclick],[onerror],[style],a'))
    .toBeNull()
  expect(document.querySelectorAll('img')).toHaveLength(1)
})
