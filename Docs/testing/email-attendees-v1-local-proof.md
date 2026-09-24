# Reproduce Email Attendees V1 locally

These commands operate only on disposable `wheretoo-email-attendees` (API61321/DB61322) and `wheretoo-email-attendees-baseline` (API62321/DB62322). Docker and installed pnpm dependencies are required. They do not link, query, migrate or deploy hosted projects. No real provider credentials are needed.

```sh
pnpm install --frozen-lockfile
python3 tests/integration/run-email-attendees-local.py start --baseline
python3 tests/integration/run-email-attendees-local.py start
python3 tests/integration/run-email-attendees-local.py reset
python3 tests/integration/email-attendees-v1-regressions.py baseline
python3 tests/integration/email-attendees-v1-regressions.py feature
python3 tests/integration/email-attendees-v1-concurrency.py
python3 tests/integration/email-attendees-v1-locks.py
python3 tests/integration/email-attendees-v1-flow.py
python3 tests/integration/email-attendees-v1-flow.py --bulk
python3 tests/integration/email-attendees-v1-fixture.py
pnpm exec playwright test --config playwright.email-attendees.config.ts
```

Run legacy SQL suites **before** creating feature fixtures. A sentinel prevents running feature legacy tests after persistent fixtures; reset only this disposable feature stack first. Receipts are never deleted to clean up proof. The baseline is pinned to `8138cdf2d6f84ff98d7ca42b595a9f87f9f7b66a`; compare `pass` and `errors` arrays in ignored `.superpowers/email-proof/{baseline,feature}/results.json`, not only totals.

The fixture generator writes local credentials only to ignored `.superpowers/email-proof/browser.json` with mode0600. It creates unique synthetic owners, completed organizer profiles, paid/free attendees and test worker readiness. It isolates previous synthetic pending jobs without deleting evidence. Fixture setup permits SELECT only temporarily within its transaction for legacy payment fixture construction, then revokes it. No production migration or runtime grant is weakened.

The connected flow uses actual owner JWT/PostgREST and production handler/worker/renderer/signature verifier code. Deno network permission allows only127.0.0.1:61321; the provider transport is injected. The normal run proves API authorization/privacy, concurrent receipt, immutable delivery equality, independent accepted/failed recipients, transport ambiguity, signed webhook/provider binding and suppression. The bulk run commits1000 unique recipients then independently processes all1000, checking exact preview bytes/distinct keys/addresses and no extra dispatch. Both compare ticket/grant/member/ticket-outbox counts before/after and close local send/worker gates in `finally`.

Browser config builds production assets with the real CSP. The fake Supabase hostname is intercepted to the dedicated local API and local façade; external provider/map/payment/image network is denied. Nine journey tests cover actual local queues plus controlled HTTP failures,390px anddesktop, focus/keyboard, logout andaccount switching. Screenshots are stored under ignored `.superpowers/email-proof/screens` and must be visually inspected.

The browser fixture intentionally leaves only **local** readiness enabled for the test. Close those local gates after proof:

```sh
docker exec supabase_db_wheretoo-email-attendees psql -X -U postgres -v ON_ERROR_STOP=1 -c "select public.server_configure_organizer_messages('{\"acceptingSends\":false,\"workerEnabled\":false}');"
```

Optional stack cleanup, after preserving any desired local evidence:

```sh
python3 tests/integration/run-email-attendees-local.py stop
python3 tests/integration/run-email-attendees-local.py stop --baseline
```

Do not use the repository's linked-only moderation integration test to validate this feature. Baseline debt and exact failures are recorded separately in `email-attendees-v1-baseline.md`. Production activation, scheduler/retention invocation, provider capacity/sender/support verification, encryption key retention, hosted migrations and deployment require a separate task.
