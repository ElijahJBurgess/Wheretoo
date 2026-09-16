const CONNECT_SCRIPT_URL = 'https://connect-js.stripe.com/v1.0/connect.js'
const WAIT_TIMEOUT_MS = 25_000

type Waiter = (error?: Error) => void
type PendingScript = {
  waiters: Set<Waiter>
  finish: (error?: Error) => void
}
let pending: PendingScript | undefined

function isReady() {
  const connect: unknown = Reflect.get(window, 'StripeConnect')
  return typeof connect === 'object' && connect !== null && 'init' in connect && typeof connect.init === 'function'
}

/** Observe Stripe's documented script/global before calling the synchronous /pure SDK loader. */
export function loadConnectScript(): Promise<void> {
  if (isReady()) {
    pending?.finish()
    return Promise.resolve()
  }

  let append: (() => void) | undefined
  if (!pending) {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CONNECT_SCRIPT_URL}"]`)
    const script = existing ?? document.createElement('script')
    const waiters = new Set<Waiter>()
    const record: PendingScript = { waiters, finish }
    function finish(error?: Error) {
      if (pending !== record) return
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      pending = undefined
      if (error && !existing) script.remove()
      for (const waiter of waiters) waiter(error)
      waiters.clear()
    }
    function onLoad() {
      finish(isReady() ? undefined : new Error('Stripe Connect loaded without its public initializer.'))
    }
    function onError() { finish(new Error('Stripe Connect script could not load.')) }
    pending = record
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    if (!existing) {
      script.src = CONNECT_SCRIPT_URL
      script.async = true
      append = () => {
        try { document.head.appendChild(script) } catch { onError() }
      }
    }
  }

  const record = pending
  const result = new Promise<void>((resolve, reject) => {
    const settle: Waiter = (error) => {
      clearTimeout(timer)
      record.waiters.delete(settle)
      if (error) reject(error)
      else resolve()
    }
    // A timeout ends this consumer's wait, not the network request. Keep one shared pair of
    // transport listeners until load/error; retries join it without retaining expired waiters.
    const timer = setTimeout(() => settle(new Error('Stripe Connect script loading timed out.')), WAIT_TIMEOUT_MS)
    record.waiters.add(settle)
  })
  append?.()
  return result
}
