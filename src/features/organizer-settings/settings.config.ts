import { z } from 'zod'
const email = z.string().trim().toLowerCase().max(320).email()
function emailValue(value: unknown): string | null { const parsed = email.safeParse(value); return parsed.success ? parsed.data : null }
function legalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password && !['localhost', 'example.com', 'example.org', 'example.net'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null
  } catch { return null }
}
export function readSettingsConfig(source: Record<string, unknown>) {
  const supportEmail = emailValue(source.VITE_ORGANIZER_SUPPORT_EMAIL) ?? emailValue(source.VITE_TICKET_SUPPORT_EMAIL)
  return { supportEmail, closureEmail: emailValue(source.VITE_ACCOUNT_CLOSURE_EMAIL) ?? supportEmail, termsUrl: legalUrl(source.VITE_TERMS_URL), privacyUrl: legalUrl(source.VITE_PRIVACY_URL) }
}
export function settingsMailto(recipient: string, subject: string, body = '') {
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
