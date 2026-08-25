import { describe, expect, it, vi } from 'vitest'
import { waitForApiJwtAcceptance } from '../shared/waitForApiJwtAcceptance'

describe('waitForApiJwtAcceptance', () => {
  it('retries only the temporary hosted clock-skew response and then succeeds', async () => {
    let clock = 0
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: 'JWT issued at future' } })
      .mockResolvedValueOnce({ error: null })

    await waitForApiJwtAcceptance(probe, {
      timeoutMs: 2_000,
      pollMs: 250,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds },
    })

    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('fails immediately for any other API response', async () => {
    const probe = vi.fn().mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(waitForApiJwtAcceptance(probe)).rejects.toThrow(
      'Disposable organizer API readiness probe failed: permission denied',
    )
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('fails after the bounded acceptance window', async () => {
    let clock = 0
    const probe = vi.fn().mockResolvedValue({ error: { message: 'JWT issued at future' } })

    await expect(waitForApiJwtAcceptance(probe, {
      timeoutMs: 2_000,
      pollMs: 1_000,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds },
    })).rejects.toThrow('within 2 seconds')
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
