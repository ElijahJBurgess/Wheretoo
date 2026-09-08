# Core Ticket Truth Lite release

This release has one persistent admission secret. Changing it in place invalidates existing credentials. The linked-development launch proof is a separate, explicitly approved operation; passing local tests does not make Lite launchable.

## Stop conditions and deployment order

1. Confirm the exact linked development project, `private.organizer_policy_release_settings.environment = 'development'`, aligned migration history, and Stripe **test** account/keys. Inspect secret **names only** and active production function names. Stop if credentials, endpoint deployments, connected-account capabilities, or exact fixture cleanup cannot be verified. Never print secrets, credentials, hashes, bearer URLs, provider payloads, or session tokens.
2. Before the first Lite migration, obtain the approved zero-ticket preflight: `select count(*) from public.tickets;` must be zero. Existing tickets require an owner decision; never delete or backfill them to pass this gate. Subsequent releases preserve tickets and must not replay that first-upgrade preflight as a deletion procedure.
3. Preserve an existing `TICKET_CREDENTIAL_SECRET`. Only if it is absent and initial configuration is approved, generate **32 random bytes**, encode as canonical unpadded base64url (43 characters), and configure it once in the server secret store. Use a protected temporary file or the secure deployment UI, with shell tracing off; keep an encrypted recoverable copy in the owner's secret store. It must have no `VITE_` name. Do not put it in source, test fixtures, logs, browser configuration, or a screenshot. The proof runner never sets, fetches, or unsets its value.
4. Capture the prior `private.checkout_runtime_control.checkout_creation_enabled` value in the release record. Set it to `false` in an approved maintenance window and verify it. Coordinate the migrations, production functions, and app as one release: apply committed migrations through `20260907010300`; deploy the updated `stripe-webhook`, `ticket-collection`, `ticket-admission`, and any changed checkout/confirmation functions; deploy the app built from the reviewed commit. Confirm all required functions are active. These are manual approved deployment steps, never runner side effects.
5. Run the local gates below, then approve the linked-development smoke proof. The proof temporarily enables checkout only after capturing the disabled prior state; on success, assertion failure, interrupt, or partial setup it settles the exact payment, cleans captured fixtures, and restores that prior state. Stop on any cleanup failure. Record safe command results and final commit, then reopen checkout to the prior appropriate state only after all launch gates pass and the owner approves opening sales.

## Verification and evidence

Use the repository's pinned toolchain. Supply an explicit disposable loopback database URL to `WHERETO_TICKETING_DB_URL` for local SQL tests; never substitute a hosted URL.

```sh
pnpm test:core-ticket-lite
pnpm typecheck
pnpm lint
pnpm test:integration:ticketing-db
pnpm test:ticket-shells:production
pnpm build
git diff --check
```

`test:integration:core-ticket-lite` runs the static runner contract, executable approval refusal, local auxiliary cleanup tests (skipped unless the disposable DB URL is provided), and the existing Deno driver contracts. Run the broader Checkout Integrity/moderation and unit gates with disabled public environment values and local SQL targets. Hosted integration and moderation scripts create shared fixtures; they require separate approval. Deno driver tests are excluded from Vitest discovery and run explicitly. Preserve the two-session `core_ticket_truth_lite_redemption_concurrency.test.sh` evidence from the local DB gate: exactly one first admission and one `already_used` result.

After approval of the exact project, temporary driver deployment, disposable connected account, Auth/Stripe fixtures, and checkout switch window:

```sh
CORE_TICKET_LITE_SHARED_APPROVED=1 pnpm test:e2e:core-ticket-lite
```

Use the existing Task17 environment prerequisites (`TEST_SUPABASE_URL`, publishable key, `pk_test_` browser key, Mapbox public token, `TEST_CONNECTED_ACCOUNT_ID`, and `TEST_CONNECTED_ACCOUNT_DISPOSABLE=1`). The runner verifies actual linked-development policy and server test mode. It reuses the exact inert audited namespace when present; a new namespace gets a random suffix and new rows use captured random UUIDs. It deploys/removes only the existing temporary transaction driver and its temporary secrets. It only checks production function/credential-secret presence.

The serial proof purchases **2 GA + 1 VIP for $55**, establishes durable payment via verified signed webhooks, follows **View tickets** into the production collection, selects all three tickets, and decodes each actual mounted QR with the existing ZXing helper. The production `createAdmissionChecker` runs with an injected **real authenticated Supabase transport** to `ticket-admission`; it must admit once, return `already_used` on retry, reject another organizer, reject unknown credentials, and reject a valid credential paired with another owned event. Duplicate paid delivery must retain the exact original source/ID/hash/status set. A verified whole-order refund must preserve the used ticket and original `used_at`, refund all unused tickets, remove their QRs, and reject their admission. Driver evidence exposes only allowlisted counts/booleans/statuses, never credentials or hashes. Test sessions and decoded values stay in memory; screenshots, video, traces, and sensitive error attachments are off.

This deterministic proof covers rendered-QR-to-authoritative-admission. Existing camera decoder tests cover camera-to-string acquisition; this does not claim physical venue/device/camera QA.

## Cleanup and recovery

Success requires zero **runtime and active provider fixture residue**, exact auxiliary draft/organizer/Auth cleanup, the temporary driver/secrets removed, and the checkout switch restored. Stripe test payments/refunds remain as immutable provider history; captured inline Prices/Products are verified inactive. The original inert audited event/organizer/Auth tombstone may remain under the established Task17 audit contract; the owner is re-banned, not deleted. Do not call this zero total database rows.

The one additional wrong-event draft is never public. Cleanup captures its exact namespace, owner/Auth identity and ID, locks the event, and refuses unexpected financial, policy, moderation, report, or tier children. Exactly one untouched version-0 initialization interval may be removed using a transaction-local replica setting around that **single scoped delete**, immediately restoring normal trigger behavior. The draft and secondary organizer are then deleted normally and checked for residue; the driver deletes/verifies only the captured secondary Auth identity. This test-only procedure never applies to the main audited event.

After failure, keep checkout closed and retain the safe stage/command evidence. Do not force deletes, restore used tickets to valid, replace refunds, reset the credential secret, remove production functions, or erase audit history to make cleanup green. Resolve the exact captured fixture/provider state under an approved recovery procedure. An unrun or failed linked proof is an open launch gate.

If the admission secret changes accidentally, treat it as an incident: stop checkout, restore the **prior exact value** from the secure backup, redeploy/restart affected functions as needed, and verify existing-ticket collection/redemption before reopening. Do not rotate in place or mint replacement credentials. A keyring/generation migration is a separate future change.
