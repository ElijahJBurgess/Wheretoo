const READ_TIMEOUT_MS = 10_000

/** Bound read-only work, including body parsing and transports that ignore abort. */
export async function withReadTimeout<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  callerSignal?.throwIfAborted()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      controller.abort(callerSignal?.reason)
      reject(controller.signal.reason)
    }
    callerSignal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      controller.abort(new DOMException('The read request timed out', 'TimeoutError'))
      reject(controller.signal.reason)
    }, READ_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return read(controller.signal)
      }),
      interrupted,
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) callerSignal?.removeEventListener('abort', onAbort)
  }
}
