# Spec 09 deferred shared integration

These exact small attachments are intentionally **not applied** while Spec 08 owns the shared router/confirmation/buyer files. The refund implementation itself is in `src/features/refunds/`. The owned organizer order page attachment is already applied and preserves `useOrder` / the V2 read. Do not overwrite Spec 08 work with the baseline file versions.

## Router attachment

In `src/app/router/router.tsx`, add this entry to the public `routes` array beside `/ticket-access`:

```tsx
{ path: '/refund-details', lazy: lazyComponent(() => import('../../features/refunds/RefundDetailsPage'), 'RefundDetailsPage') },
```

The exported `refundRoutes` array provides the same route for an isolated test mount. A production eager import is unnecessary. The refund page captures its own fragment and stores only its own purpose-specific grant. Existing `captureTicketAccess()` already checks `/ticket-access` exactly, so it must remain unchanged. Do not route `/refund-details` through TicketEmailAccessPage or ticket recovery. A lost/expired/revoked financial grant renders the unavailable state and configured support only.

## Existing refunded confirmation attachment

In `src/features/buyer-journey/OrderConfirmationView.tsx`:

```diff
+import { RefundSupportContext } from '../refunds/RefundedTicketContext'
@@
   refunded: {
     heading: 'This order was refunded',
-    message: 'This ticket is no longer valid.',
+    message: 'The full order refund is confirmed. Unused tickets are no longer valid for entry; previous check-ins remain in the event history.',
@@
       <BuyerEventSummary title={order.event.title} schedule={formatSchedule(order.event)} venue={order.event.venueName ?? 'Venue to be announced'} />
+      {order.status === 'refunded' ? <RefundSupportContext orderNumber={order.orderNumber} /> : null}
```

This uses only the already-authorized order number and canonical confirmation status. No new query, financial bearer, ticket recovery action, calendar action or credential is introduced. `OrderConfirmationPage.tsx` requires no edit for this attachment.

## Existing inactive ticket support attachment

In `src/features/ticket-experience/customer/FocusedTicketView.tsx`:

```diff
+import { RefundSupportContext } from '../../refunds/RefundedTicketContext'
@@
         <BuyerEventSummary title={ticket.eventName} schedule={formatBuyerSchedule(ticket.startsAt, ticket.endsAt, ticket.timezone)} venue={ticket.venueName} />
+        {status === 'refunded' ? <RefundSupportContext /> : null}
```

Keep `InactiveTicketArtwork` and the existing admission-credential discriminated union unchanged. The current paid collection DTO intentionally has no safe order reference/usedAt projection. Do not fabricate a reference from selectors or tokens or relax its strict parser. The new refund-detail page already supplies the authorized order reference and exact Used timestamp through its separate financial grant. Expanding the existing paid collection DTO requires coordinated backend/adapter/schema changes and is not part of this small attachment.

## Verification before integration

Re-run existing router, OrderConfirmationView/Page, FocusedTicketView and refund tests after the shared owner applies the attachments. Production-route smoke: open `/refund-details#<synthetic grant>`, verify fragment removal, confirmed full amount, Used/Refunded distinction, no QR, no external/provider data, expired/revoked grant does not expose cached financial data, no current-ticket recovery link. Do not use real buyer data or enable external delivery.

The dedicated UI harness at `tests/e2e/spec09-harness/` mounts the production components now; its README lists the launch URL and intercepted transport contracts. No production entry imports the harness or test fixtures. Configured `VITE_TICKET_SUPPORT_EMAIL` / `DeliverySupport` are the only support destination; no organizer login address is substituted.
