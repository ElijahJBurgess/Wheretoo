import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { captureIdentityLifetime } from '../auth/identityLifetime'
const schema = z.strictObject({
  visits: z.number(),
  ticketStarts: z.number(),
  rsvpStarts: z.number(),
  paidOrders: z.number(),
  confirmedRsvps: z.number(),
  grossByCurrency: z.array(
    z.strictObject({ currency: z.string(), amountMinor: z.number() }),
  ),
  refLabels: z.array(
    z.strictObject({ ref: z.string().nullable(), visits: z.number() }),
  ),
})
export function StorefrontInsights({ userId }: { userId: string }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['organizer-settings', 'storefront-insights', userId],
    queryFn: async () => {
      const current = captureIdentityLifetime(client, userId)
      const { data, error } = await supabase.rpc(
        'get_owned_storefront_insights',
      )
      if (error || !current()) throw new Error('Insights unavailable')
      return schema.parse(data)
    },
    retry: false,
    gcTime: 0,
  })
  return (
    <section className='settings-panel'>
      <h3>Storefront insights</h3>
      <p>
        All-time measured activity. Attribution lasts 30 days. Counts may be
        incomplete when measurement is unavailable.
      </p>
      {query.isPending
        ? <p role='status'>Loading insights…</p>
        : query.isError
        ? (
          <p>
            Insights are unavailable.{' '}
            <button type='button' onClick={() => void query.refetch()}>
              Retry insights
            </button>
          </p>
        )
        : (
          <>
            <dl>
              {[
                ['Visits', query.data.visits],
                ['Ticket starts', query.data.ticketStarts],
                ['RSVP starts', query.data.rsvpStarts],
                ['Paid orders', query.data.paidOrders],
                ['Confirmed RSVPs', query.data.confirmedRsvps],
              ].map(([name, count]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <h4>Attributed ticket gross</h4>
            <p>
              Completed ticket item totals before refunds. Excludes fees and
              taxes; this is not a payout balance.
            </p>
            {query.data.grossByCurrency.length
              ? query.data.grossByCurrency.map((row) => (
                <p key={row.currency}>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: row.currency,
                  }).format(row.amountMinor / 100)}
                </p>
              ))
              : <p>No attributed paid sales yet.</p>}
            {query.data.refLabels.length
              ? (
                <>
                  <h4>Visit sources</h4>
                  <ul>
                    {query.data.refLabels.map((row) => (
                      <li key={row.ref ?? ''}>
                        {row.ref ?? 'Direct'}: {row.visits}
                      </li>
                    ))}
                  </ul>
                </>
              )
              : null}
          </>
        )}
    </section>
  )
}
