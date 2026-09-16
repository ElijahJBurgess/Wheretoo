/* Explicit setup for the task server only; no application state is modified. */
const status = document.getElementById('status')
const enable = document.getElementById('enable')
const disable = document.getElementById('disable')
const origins = ['http://127.0.0.1:3040', 'http://localhost:3040']

enable.addEventListener('click', async () => {
  enable.disabled = true
  try {
    if (!origins.includes(location.origin) || !('serviceWorker' in navigator)) throw new Error('Unsupported local browser')
    const response = await fetch('/__spec14/identity', { cache: 'no-store' })
    const identity = await response.json()
    if (!response.ok || identity.task !== 'spec14-final-assembly' || identity.providers !== 'local simulation only') throw new Error('Wrong task')
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (existing && ![existing.active, existing.waiting, existing.installing].filter(Boolean).every(worker => new URL(worker.scriptURL).pathname === '/__spec14/address-worker.js')) throw new Error('Another worker owns this local origin')
    await navigator.serviceWorker.register('/__spec14/address-worker.js', { scope: '/', updateViaCache: 'none' })
    await Promise.race([
      new Promise(resolve => {
        const ready = () => {
          if (navigator.serviceWorker.controller?.scriptURL === location.origin + '/__spec14/address-worker.js') {
            navigator.serviceWorker.removeEventListener('controllerchange', ready)
            resolve()
          }
        }
        navigator.serviceWorker.addEventListener('controllerchange', ready)
        ready()
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Activation timeout')), 15000)),
    ])
    status.textContent = 'Local address simulator ready. Return to your event tab, clear the address, type again and select 1 Market Street. Your existing draft is unchanged.'
  } catch {
    status.textContent = 'Could not enable the local address simulator. Keep your event tab open and retry here.'
  } finally { enable.disabled = false }
})

disable.addEventListener('click', async () => {
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (registration?.active?.scriptURL === location.origin + '/__spec14/address-worker.js') await registration.unregister()
  status.textContent = 'Local address simulator removed. Close or reload this origin’s tabs to stop the current worker. No event data was changed.'
})
