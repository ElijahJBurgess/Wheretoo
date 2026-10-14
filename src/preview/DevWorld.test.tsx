import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PreviewApp } from './PreviewApp'
import { demoEvents } from './devWorldCatalog'
afterEach(cleanup)
it('opens the actual guest route with document navigation, distinct from static previews', () => {
  window.history.replaceState({}, '', '/preview')
  render(<PreviewApp />)
  const live = screen.getByRole('link', { name: 'Open live buyer flow' })
  expect(live).toHaveAttribute('href', `/events/${demoEvents[0].id}`)
  fireEvent.click(screen.getByText('Testing this flow'))
  expect(screen.getByText('4242 4242 4242 4242')).toBeVisible()
  expect(screen.getByText(/2 General Admission.*1 VIP.*\$85/)).toBeVisible()
})
