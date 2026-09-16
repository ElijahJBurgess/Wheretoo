import { demoEvents } from './devWorldCatalog'

const statePreviews = [
  ['Ticket collection / valid QR', 'wh_test_collection_paid_multi'],
  ['Used / already scanned', 'wh_test_collection_used'],
  ['Refunded', 'wh_test_collection_refunded'],
  ['Cancelled', 'wh_test_collection_cancelled'],
] as const

export function DevWorld() {
  return (
    <section aria-labelledby="dev-world-title" className="dev-world">
      <p className="organizer-eyebrow">Live flow · Stripe TEST only</p>
      <h2 id="dev-world-title">Try Wheretoo as a guest</h2>
      <p>Start with After Hours Oakland. Choose tickets, complete a test payment, then open your tickets and QR. No account needed.</p>
      {/* Full navigation enters the real app, outside the isolated preview router. */}
      <a className="ui-button ui-button--primary" href={`/events/${demoEvents[0].id}`}>Open live buyer flow</a>
      <p>Try 2 General Admission + 1 VIP: $85 for 3 tickets.</p>
      <details>
        <summary>Testing this flow</summary>
        <ol>
          <li>Open the demo event and choose ticket quantities.</li>
          <li>Review the total and enter a fictional buyer name and email, such as buyer@example.invalid.</li>
          <li>Continue to Stripe TEST checkout.</li>
          <li>Use <code>4242 4242 4242 4242</code>, a future expiration date, and any valid CVC and postal code.</li>
          <li>Finish the test payment and return to Wheretoo.</li>
          <li>Wait for payment confirmation, then choose View tickets and open a QR ticket.</li>
        </ol>
        <p>Need fresh capacity or dates? Run <code>pnpm dev:reset</code>. Existing tickets and purchase history stay intact. First setup: <code>pnpm dev:seed</code>.</p>
      </details>
      <details>
        <summary>Explore the development events</summary>
        <ul>{demoEvents.map(event => <li key={event.id}><a href={`/events/${event.id}`}>{event.title}</a><span>{event.paid ? 'Live TEST checkout' : 'Live event page · display only'}</span></li>)}</ul>
      </details>
      <details>
        <summary>Ticket state previews</summary>
        <p>Interactive synthetic states using existing ticket components. These are not purchased tickets.</p>
        <ul>{statePreviews.map(([name, scenario]) => <li key={scenario}><a href={`/tickets/${scenario}`}>{name}</a><span>Preview</span></li>)}</ul>
      </details>
    </section>
  )
}
