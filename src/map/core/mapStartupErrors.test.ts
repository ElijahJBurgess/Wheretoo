import { describe, expect, it } from 'vitest'
import { describeStartupError } from './mapStartupErrors'

describe('map startup diagnostics', () => {
  it.each([400, 401, 403, 404])('classifies a confirmed base-style HTTP %s without retaining the URL', status => {
    const result = describeStartupError({ error: { status, url: 'https://api.mapbox.com/styles/v1/mapbox/standard?access_token=PRIVATE' } })
    expect(result.fatal).toBe(status === 401 || status === 403 ? 'TOKEN_INVALID' : 'STYLE_LOAD_FAILED')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it.each([
    { sourceId: 'basemap', error: { status: 401, url: 'https://api.mapbox.com/styles/v1/mapbox/standard' } },
    { error: { status: 401, url: 'https://project.supabase.co/storage/v1/object/icon.png' } },
    { error: { status: 404, url: 'https://api.mapbox.com/styles/v1/mapbox/standard/sprite.json' } },
    { error: { status: 503, url: 'https://api.mapbox.com/styles/v1/mapbox/standard' } },
    { error: new Error('network error with PRIVATE credentials') }, null,
  ])('keeps unrelated, transient and unknown errors recoverable', event => {
    const result = describeStartupError(event)
    expect(result.fatal).toBeNull()
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
})
