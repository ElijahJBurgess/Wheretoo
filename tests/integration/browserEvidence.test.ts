import { describe, expect, it } from 'vitest'
import { isIgnorableBrowserRequestFailure, redactBrowserUrl } from '../shared/browserEvidence'

describe('redactBrowserUrl', () => {
  it('uses an opaque digest for hosted origins and redacts every query value', () => {
    const raw = 'https://project-ref.supabase.co/rest/v1/events?id=eq.secret-event&apikey=secret-value'
    const redacted = redactBrowserUrl(raw)

    expect(redacted).toMatch(/^<external-origin:[a-f0-9]{12}>\/rest\/v1\/events\?id=<redacted>&apikey=<redacted>$/)
    expect(redacted).not.toContain('project-ref')
    expect(redacted).not.toContain('secret-event')
    expect(redacted).not.toContain('secret-value')
  })

  it('labels the canonical app without persisting its host', () => {
    expect(redactBrowserUrl('http://127.0.0.1:3000/organizer/events')).toBe(
      '<local-app>/organizer/events',
    )
  })
})

describe('isIgnorableBrowserRequestFailure', () => {
  it('ignores only an aborted Mapbox telemetry request', () => {
    expect(
      isIgnorableBrowserRequestFailure(
        'https://api.mapbox.com/events/v2?access_token=public-token',
        'net::ERR_ABORTED',
      ),
    ).toBe(true)
    expect(
      isIgnorableBrowserRequestFailure(
        'https://api.mapbox.com/search/searchbox/v1/suggest',
        'net::ERR_ABORTED',
      ),
    ).toBe(false)
    expect(
      isIgnorableBrowserRequestFailure('https://api.mapbox.com/events/v2', 'net::ERR_FAILED'),
    ).toBe(false)
    expect(
      isIgnorableBrowserRequestFailure('https://events.mapbox.com/events/v2', 'net::ERR_ABORTED'),
    ).toBe(false)
  })
})

describe('hosted browser evidence', () => {
  it('redacts hosted Checkout paths and every transient query value before browser evidence is saved', () => {
    const redacted = redactBrowserUrl('https://checkout.stripe.com/c/pay/cs_test_hidden?client_reference_id=private&token=private')

    expect(redacted).toMatch(/^<external-origin:[a-f0-9]{12}>\/c\/pay\/cs_test_hidden\?client_reference_id=<redacted>&token=<redacted>$/)
    expect(redacted).not.toContain('private')
  })
})
