import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MapStartupFallback } from './MapStartupOverlay'

afterEach(() => vi.useRealTimers())
it('also times out a stalled discovery module and cleans its shared startup timer', () => {
  vi.useFakeTimers()
  const retry = vi.fn()
  const view = render(<MapStartupFallback onRetry={retry} />)
  expect(screen.getByRole('status', { name: 'Loading map' })).toBeVisible()
  act(() => vi.advanceTimersByTime(15000))
  expect(screen.getByText('The map is taking longer than expected.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
