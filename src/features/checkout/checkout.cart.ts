import { checkoutItemsSchema, type CheckoutItem } from './checkout.schemas'
import { lowercaseRfcUuidSchema } from '../tickets/ticket.schemas'

export const MAX_CHECKOUT_QUANTITY = 10

export function encodeCheckoutCart(items: readonly CheckoutItem[]): string {
  const canonicalItems = checkoutItemsSchema.parse(items)
  const search = new URLSearchParams()
  canonicalItems.forEach((item) => search.append('item', `${item.tierId}:${item.quantity}`))
  return search.toString()
}

export function parseCheckoutCart(
  search: string | URLSearchParams,
  _knownTierIds?: readonly string[],
): CheckoutItem[] | null {
  void _knownTierIds // Membership is reviewed separately; existing callers may still supply this argument.
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  if ([...params.keys()].some((key) => key !== 'item')) return null

  const rawItems = params.getAll('item').map((value) => {
    const match = /^([a-fA-F0-9-]{36}):(\d+)$/.exec(value)
    return match === null ? null : { tierId: match[1], quantity: Number(match[2]) }
  })
  if (rawItems.some((item) => item === null)) return null

  const parsed = checkoutItemsSchema.safeParse(rawItems)
  if (!parsed.success) return null
  return parsed.data
}

export function checkoutSelectionPath(eventId: string, items: readonly CheckoutItem[]): string {
  return `/events/${lowercaseRfcUuidSchema.parse(eventId)}/tickets?${encodeCheckoutCart(items)}`
}
