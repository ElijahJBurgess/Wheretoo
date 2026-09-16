import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import { readSettingsConfig, settingsMailto } from './settings.config'
describe('Settings destinations', () => {
  it('has honest unavailable defaults', () => expect(readSettingsConfig({})).toEqual({ supportEmail: null, closureEmail: null, termsUrl: null, privacyUrl: null }))
  it('uses validated explicit destinations and the existing ticket-support fallback', () => {
    expect(readSettingsConfig({ VITE_TICKET_SUPPORT_EMAIL: ' Team@wheretoo.app ', VITE_TERMS_URL: 'https://wheretoo.app/terms', VITE_PRIVACY_URL: 'https://wheretoo.app/privacy' })).toEqual({ supportEmail: 'team@wheretoo.app', closureEmail: 'team@wheretoo.app', termsUrl: 'https://wheretoo.app/terms', privacyUrl: 'https://wheretoo.app/privacy' })
    expect(readSettingsConfig({ VITE_ORGANIZER_SUPPORT_EMAIL: 'organizer@wheretoo.app', VITE_ACCOUNT_CLOSURE_EMAIL: 'review@wheretoo.app' }).closureEmail).toBe('review@wheretoo.app')
  })
  it.each(['javascript:alert(1)', 'http://wheretoo.app/terms', 'https://name:secret@wheretoo.app/terms', 'https://example.com/terms', '/organizer-terms'])('rejects unapproved or unsafe legal destination %s', value => expect(readSettingsConfig({ VITE_TERMS_URL: value }).termsUrl).toBeNull())
  it('rejects injected email headers and encodes only supplied context', () => {
    expect(readSettingsConfig({ VITE_ORGANIZER_SUPPORT_EMAIL: 'a@wheretoo.app\r\nBcc:x@y.com' }).supportEmail).toBeNull()
    const url = settingsMailto('team@wheretoo.app', 'Closure review', 'Name & reason\nNo secrets')
    expect(url).toContain('body=Name%20%26%20reason%0ANo%20secrets')
    expect(url).not.toContain('Bcc=')
  })
})

it('Spec10 notice support and Spec11 Help/closure destinations coexist independently', () => {
  vi.stubEnv('VITE_TICKET_SUPPORT_EMAIL', 'notices@example.invalid')
  vi.stubEnv('VITE_ORGANIZER_SUPPORT_EMAIL', 'organizers@example.invalid')
  vi.stubEnv('VITE_ACCOUNT_CLOSURE_EMAIL', 'closure@example.invalid')
  try {
    const help = readSettingsConfig(import.meta.env)
    expect(help.supportEmail).toBe('organizers@example.invalid')
    expect(help.closureEmail).toBe('closure@example.invalid')
    // Event status uses this same buyer-facing support component.
    const buyerSupport = renderToStaticMarkup(createElement(DeliverySupport))
    expect(buyerSupport).toContain('mailto:notices%40example.invalid')
    expect(buyerSupport).not.toContain('organizers')
    expect(buyerSupport).not.toContain('closure')
    expect(readSettingsConfig({ VITE_ORGANIZER_SUPPORT_EMAIL: 'invalid' }).supportEmail).toBeNull()
  } finally {
    vi.unstubAllEnvs()
  }
})
