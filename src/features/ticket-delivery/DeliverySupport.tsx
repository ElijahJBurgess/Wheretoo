import { emailSchema } from './delivery.schemas'
export function DeliverySupport({ email = import.meta.env.VITE_TICKET_SUPPORT_EMAIL }: { email?: string }) {
  const parsed = emailSchema.safeParse(email)
  return parsed.success ? <a className='delivery-support' href={'mailto:' + encodeURIComponent(parsed.data)}>Contact support</a> : null
}
