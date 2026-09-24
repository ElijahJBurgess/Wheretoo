import { describe, expect, it } from 'vitest'
import { emailRenderer } from './renderEmail'
const props = { organizerName: 'Hosts', eventName: 'Night', startsAtLabel: 'September 23, 2026, 12:00 PM UTC', venueName: 'Hall', supportEmail: 'support@example.com', subject: 'Doors & details', body: 'First line\nSecond line\n<script>alert("x")</script>\nhttps://untrusted.example' }
describe('OrganizerMessageEmail', () => {
  it('escapes organizer content, preserves line breaks, and remains complete without optional assets', async () => {
    const { html, text } = await emailRenderer.render({ kind: 'organizer_message', props })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="https://untrusted.example')
    expect(text).toContain('First line\nSecond line')
    expect(text).toContain('Hosts via Wheretoo')
    expect(text).toContain('September 23, 2026')
    expect(text).toContain('Hall')
    expect(text).toContain('Replies go to Wheretoo support: support@example.com')
    expect(text).toContain('when the organizer queued it')
    expect(html).not.toMatch(/ticket-access|View Tickets|private link|grantId|QR/)
  })
  it('includes optional public imagery and event CTA without private access wording', async () => {
    const { html, text } = await emailRenderer.render({ kind: 'organizer_message', props: { ...props, flyerUrl: 'https://media.example/functions/v1/event-images?id=fixture', organizerLogoUrl: 'https://media.example/functions/v1/organizer-media?id=fixture', eventUrl: 'https://app.example/events/event' } })
    expect(html).toContain('src="https://media.example/functions/v1/event-images')
    expect(html).toContain('src="https://media.example/functions/v1/organizer-media')
    expect(text).toContain('View Event')
    expect(html).not.toContain('private link')
  })
})
