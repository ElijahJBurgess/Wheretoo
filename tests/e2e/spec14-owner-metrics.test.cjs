const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the selected helper itself without importing/registering the browser spec.
const specPath = path.join(__dirname, 'spec14.spec.ts')
const source = ts.createSourceFile(specPath, fs.readFileSync(specPath, 'utf8'), ts.ScriptTarget.Latest, true)
const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ownerMetrics')
assert.ok(helper, 'the actual ownerMetrics helper must be present')
const javascript = ts.transpileModule(helper.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const origin = 'http://127.0.0.1:3040'
const eventId = '11111111-1111-4111-8111-111111111111'
const dashboard = origin + '/organizer/events/' + eventId + '/dashboard'
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture(navigate, initialUrl = origin + '/organizer/events') {
  const timers = new Map()
  let timerId = 0
  const ownerMetrics = vm.runInNewContext(javascript + '\nownerMetrics', {
    origin, URL,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  class Page extends EventEmitter {
    constructor() { super(); this.currentUrl = initialUrl; this.frame = { url: () => this.currentUrl }; this.jsonReads = [] }
    mainFrame() { return this.frame }
    commit(url = dashboard) { this.currentUrl = url; this.emit('framenavigated', this.frame) }
    async goto(url) { assert.equal(url, dashboard); return navigate(this) }
    waitForResponse(predicate) {
      return new Promise(resolve => {
        const onResponse = response => { if (predicate(response)) { this.off('response', onResponse); resolve(response) } }
        this.on('response', onResponse)
      })
    }
    request(options = {}) {
      const request = {
        url: () => options.url ?? origin + '/rest/v1/rpc/get_organizer_event_metrics',
        method: () => options.method ?? 'POST',
        postDataJSON: () => ({ p_event_id: options.eventId ?? eventId }),
        frame: () => options.frame ?? this.frame,
      }
      this.emit('request', request)
      return request
    }
    respond(request, label, options = {}) {
      const response = {
        request: () => request, url: request.url, ok: () => options.ok !== false,
        json: async () => {
          this.jsonReads.push(label)
          if (options.error) throw options.error
          if (options.available && !options.available()) throw new Error('Network.getResponseBody: document navigated away')
          return { marker: label }
        },
      }
      this.emit('response', response)
      return response
    }
  }
  const page = new Page()
  return { page, timers, run: () => ownerMetrics(page, eventId), clean: () => {
    assert.equal(page.eventNames().length, 0, 'all capture listeners must be removed')
    assert.equal(timers.size, 0, 'the bounded capture timer must be cleared')
  } }
}

for (const initialUrl of [origin + '/organizer/events', dashboard]) {
  test('ignores outgoing-page requests even when their response arrives after dashboard commit: ' + new URL(initialUrl).pathname, async () => {
    const f = fixture(async page => {
      const stale = page.request()
      page.commit()
      page.respond(stale, 'outgoing', { error: new Error('obsolete outgoing response must not be read') })
      const fresh = page.request()
      page.respond(fresh, 'initiated-dashboard')
      await turn()
    }, initialUrl)
    assert.equal((await f.run()).marker, 'initiated-dashboard')
    assert.deepEqual(f.page.jsonReads, ['initiated-dashboard'])
    f.clean()
  })
}

test('reads the actual response body before goto completes and its browser body becomes unavailable', async () => {
  let available = true
  const f = fixture(async page => {
    page.commit()
    page.respond(page.request(), 'fresh-body', { available: () => available })
    await turn()
    available = false
  })
  assert.equal((await f.run()).marker, 'fresh-body')
  f.clean()
})

test('requires the committed main-frame exact local POST and event identity', async () => {
  const f = fixture(async page => {
    page.commit()
    for (const options of [
      { frame: { url: () => dashboard } }, { eventId: 'other-event' }, { method: 'GET' },
      { url: 'http://127.0.0.1:55647/rest/v1/rpc/get_organizer_event_metrics' },
      { url: origin + '/rest/v1/rpc/not_get_organizer_event_metrics' },
    ]) page.respond(page.request(options), 'wrong-boundary')
    page.respond(page.request(), 'exact-boundary')
    await turn()
  })
  assert.equal((await f.run()).marker, 'exact-boundary')
  assert.deepEqual(f.page.jsonReads, ['exact-boundary'])
  f.clean()
})

test('rejects the real non-success response and does not read or substitute its body', async () => {
  const f = fixture(async page => {
    page.commit(); page.respond(page.request(), 'denied', { ok: false }); await turn()
  })
  await assert.rejects(f.run(), /Actual owner metrics read failed/)
  assert.deepEqual(f.page.jsonReads, [])
  f.clean()
})

test('handles an immediate body rejection while navigation is still pending and cleans up', async () => {
  let finishNavigation
  const navigation = new Promise(resolve => { finishNavigation = resolve })
  const f = fixture(async page => {
    page.commit(); page.respond(page.request(), 'body-error', { error: new Error('actual body failure') }); await navigation
  })
  const result = f.run().then(value => ({ value }), error => ({ error }))
  await turn()
  const capturedBeforeNavigationEnds = f.page.jsonReads.length === 1
  finishNavigation()
  const outcome = await result
  assert.equal(capturedBeforeNavigationEnds, true)
  assert.match(outcome.error.message, /actual body failure/)
  f.clean()
})

test('navigation rejection removes the capture without an unhandled response promise', async () => {
  const f = fixture(async () => { throw new Error('navigation failed') })
  await assert.rejects(f.run(), /navigation failed/)
  f.clean()
})

test('missing metrics has a bounded timeout and removes its listeners', async () => {
  const f = fixture(async page => { page.commit() })
  const result = f.run().then(value => ({ value }), error => ({ error }))
  await turn()
  assert.equal(f.timers.size, 1)
  for (const timer of f.timers.values()) {
    assert.ok(timer.delay > 0 && timer.delay <= 40_000)
    timer.callback()
  }
  const outcome = await result
  assert.match(outcome.error.message, /metrics.*timed out/i)
  f.clean()
})
