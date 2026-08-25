type ApiProbeResult = { error: { message: string } | null }

type WaitOptions = {
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export async function waitForApiJwtAcceptance(
  probe: () => PromiseLike<ApiProbeResult>,
  options: WaitOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 20_000
  const pollMs = options.pollMs ?? 1_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const deadline = now() + timeoutMs

  while (now() < deadline) {
    const result = await probe()
    if (result.error === null) return
    if (result.error.message !== 'JWT issued at future') {
      throw new Error(`Disposable organizer API readiness probe failed: ${result.error.message}`)
    }
    await sleep(pollMs)
  }

  throw new Error(`Disposable organizer API did not accept the fresh JWT within ${timeoutMs / 1_000} seconds.`)
}
