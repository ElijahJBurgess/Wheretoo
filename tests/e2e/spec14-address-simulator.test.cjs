const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const workerPath = path.resolve('tests/integration/spec14-address-worker.js')

function worker(origin = 'http://127.0.0.1:3040') {
  assert.ok(fs.existsSync(workerPath), 'Ordinary local browsers need the address provider worker')
  const listeners = {}
  const fixture = JSON.parse(fs.readFileSync('tests/e2e/support/spec14-address-fixture.json', 'utf8'))
  let localFetches = 0
  const self = { location: new URL(origin + '/__spec14/address-worker.js'), addEventListener: (name, fn) => { listeners[name] = fn }, skipWaiting: async () => {}, clients: { claim: async () => {} } }
  vm.runInNewContext(fs.readFileSync(workerPath, 'utf8'), { self, URL, Response, Request, fetch: async url => { assert.equal(String(url), origin + '/__spec14/address-fixture.json'); localFetches++; return Response.json(fixture) } })
  const request = async (url, method = 'GET') => {
    let response
    listeners.fetch?.({ request: new Request(url, { method }), respondWith: value => { response = value } })
    return response ? await response : null
  }
  return { request, listeners, localFetches: () => localFetches, fixture }
}

test('normal input returns a fixed selectable fixture and retrieve preserves its verified fields', async () => {
  const w = worker()
  const suggest = await w.request('https://api.mapbox.com/search/searchbox/v1/suggest?q=123%20Main%20Street&session_token=local')
  assert.equal(suggest.status, 200)
  const suggestions = (await suggest.json()).suggestions
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].name, '1 Market Street')
  assert.notEqual(suggestions[0].name, '123 Main Street')
  const retrieved = await w.request('https://api.mapbox.com/search/searchbox/v1/retrieve/' + suggestions[0].mapbox_id + '?session_token=local')
  assert.equal(retrieved.status, 200)
  const body = await retrieved.json()
  assert.equal(body.features[0].properties.context.region.region_code, 'CA')
  assert.deepEqual(body.features[0].geometry.coordinates, [-122.3958, 37.7936])
  assert.deepEqual(body.features[0].properties.coordinates, w.fixture.coordinates)
})

test('short input is empty; unknown identities and unsupported writes are rejected locally', async () => {
  const w = worker()
  assert.deepEqual((await (await w.request('https://api.mapbox.com/search/searchbox/v1/suggest?q=x')).json()).suggestions, [])
  assert.equal((await w.request('https://api.mapbox.com/search/searchbox/v1/retrieve/arbitrary-typed-address')).status, 404)
  assert.equal((await w.request('https://api.mapbox.com/search/searchbox/v1/suggest?q=market', 'POST')).status, 405)
})

test('does not intercept app, Auth, payment, other-provider or map-tile requests', async () => {
  const w = worker()
  for (const url of ['http://127.0.0.1:3040/rest/v1/events', 'http://127.0.0.1:3040/auth/v1/user', 'https://api.stripe.com/v1/checkout/sessions', 'https://api.mapbox.com/styles/v1/mapbox/streets', 'https://example.com/search/searchbox/v1/suggest']) assert.equal(await w.request(url), null)
  assert.equal(w.localFetches(), 0)
})

test('never installs provider interception on a hosted origin', () => {
  const w = worker('https://staging.example.com')
  assert.equal(w.listeners.fetch, undefined)
})
