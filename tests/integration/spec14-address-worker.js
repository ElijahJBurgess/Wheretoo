/* Task-only provider transport. Never included in or registered by the app build. */
if (['http://127.0.0.1:3040', 'http://localhost:3040'].includes(self.location.origin)) {
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (url.origin === 'https://events.mapbox.com') {
      event.respondWith(Promise.resolve(new Response(null, { status: 204 })))
      return
    }
    if (url.origin !== 'https://api.mapbox.com' || !url.pathname.startsWith('/search/searchbox/')) return
    event.respondWith(addressResponse(event.request, url))
  })
}

async function addressResponse(request, url) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (request.method !== 'GET') return reply({ message: 'Read-only local address simulator' }, 405)
  try {
    const response = await fetch(self.location.origin + '/__spec14/address-fixture.json')
    if (!response.ok) return reply({ message: 'Local address fixture unavailable' }, 503)
    const fixture = await response.json()
    const attribution = 'Local synthetic address response — fixed test location, not a real address lookup'
    if (url.pathname === '/search/searchbox/v1/suggest') {
      return reply({ suggestions: (url.searchParams.get('q') || '').trim().length < 2 ? [] : [{ ...fixture, distance: 0 }], attribution })
    }
    if (url.pathname === '/search/searchbox/v1/retrieve/' + fixture.mapbox_id) {
      return reply({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [fixture.coordinates.longitude, fixture.coordinates.latitude] }, properties: fixture }], attribution })
    }
    return reply({ message: 'Unknown local address fixture' }, 404)
  } catch {
    return reply({ message: 'Local address simulator unavailable' }, 503)
  }
}
