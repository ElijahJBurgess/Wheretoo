# Isolated Spec 09 browser mount

This test-only HTML/module is served by Vite development mode, never imported by the production entry or router. It renders real SessionProvider, QueryClient, OperationsLayout, RefundOrderPanel, OrganizerOrderDetailPage and the exported refundRoutes.

Launch from this worktree:

```sh
VITE_SUPABASE_URL=https://spec09-local.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_spec09_local VITE_MAPBOX_ACCESS_TOKEN=spec09-disabled VITE_STRIPE_PUBLISHABLE_KEY=pk_test_spec09_disabled pnpm exec vite --host 127.0.0.1 --port 3019
```

URLs:

- `http://127.0.0.1:3019/tests/e2e/spec09-harness/index.html?view=panel`
- `http://127.0.0.1:3019/tests/e2e/spec09-harness/index.html?view=order`
- `http://127.0.0.1:3019/tests/e2e/spec09-harness/index.html?view=buyer#em1_…`

Optional `eventId` / `orderId` parameters choose a synthetic fixture. Defaults equal `src/features/refunds/refunds.fixtures.ts` (`refundFixture` and `detailFixture` are test data only). The buyer view consumes/removes the hash and reloads its separate sessionStorage refund grant.

Before navigation, Playwright should seed the standard Supabase local session key `sb-spec09-local-auth-token` with a synthetic authenticated user using the fixture owner UUID. Intercept the exact `https://spec09-local.supabase.co` origin and block all non-loopback unhandled traffic. No production account or real provider call is needed.

Requests available for interception/loopback forwarding:

- panel: `POST /rest/v1/rpc/get_organizer_refund_status` body `{p_event_id,p_order_id}`; strict canonical DTO in approved plan.
- request: `POST /functions/v1/organizer-refund-order` body `{eventId,orderId,action:'submit'|'reconcile'}`.
- completed panel: `POST /rest/v1/rpc/get_organizer_refund_notice_status` body `{p_event_id,p_order_id}`.
- buyer: `POST /functions/v1/refund-detail-access` body `{token}`; strict ready DTO in `refunds.schemas.ts`.
- full order view additionally reads owned event + legacy `get_organizer_order_v2`; use the actual DB/Edge bridge for these.

Mutate the intercepted server snapshot, then press “Refresh refund status” or allow visible-page progress polling. UI completion requires canonical `state:'completed'`; the request result alone never completes it. Keep screenshots synthetic and traces/video off; never capture bearer tokens, storage or network payloads.
