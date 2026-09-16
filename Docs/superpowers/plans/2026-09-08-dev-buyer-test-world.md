# Development buyer test world implementation plan

Goal: persistent, guest-accessible Stripe TEST buyer journey entered from /preview.
Architecture: reuse buyer routes, server payment fulfillment, collection/admission adapters and existing development fixture guard conventions. Keep destructive Task14/17 proof tombstones intact; reuse their configured TEST account, with a separate deterministic persistent dataset. No schema migration, production deployment, map, or payment architecture changes.

- [x] Add guarded operator seed/reset command and deterministic seven-event catalog. Validate exact linked development project, migration head, existing TEST account readiness, immutable ownership markers and identities. Seed uses current publication/requirements/policy APIs. Reset raises capacity above all historical order quantities without deleting financial truth. Temporary read-only Stripe probe is removed even on failure; no account creation or retirement.
- [x] Add live buyer front door and clearly labeled static/state previews. Real collection bearers use production readers in development; known synthetic scenarios retain existing readers. Production excludes world content.
- [x] Run fixture guard, checkout/order/ticket, routing and preview tests; typecheck, lint, build and diff check. Test seed twice and reset preserving history.
- [x] Verify /preview to event, 2 GA + 1 VIP, buyer details, hosted TEST checkout, confirmed payment, exactly three tickets, collection, QR. Inspect desktop and mobile. Document exact commands/URLs and limitations.

Spec: user request supplied in pasted-text.txt, September 8, 2026. Visual Reference edits remain untouched. Never merge main or deploy production. Never insert paid orders/tickets or reset used/refunded ticket status.
