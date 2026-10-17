# Task 6A migration review and rollback

Migration: `20261016030000_recheck_paid_admission_after_lock_waits.sql`.

The migration changes only `private.reserve_checkout(uuid,jsonb,text,text,uuid,text)`. It reads the audited definition with `pg_get_functiondef`, checks its exact baseline MD5 (`556c9cafcea77ec2ee81c260d84d14a7`), verifies one insertion point, and executes the same definition with one added final canonical eligibility check. `pg_catalog.clock_timestamp()` is sampled after the event/tier/order/account/fee lock waits and expired-order updates, immediately before allocating/inserting a new order. The exact persisted-request recovery branch returns before this check.

The current statement-time variable, inventory calculation, fee snapshot, Connect checks, request digest, lock ordering, issued ticket history, fulfillment and payment handlers are unchanged. No tables, indexes, policies, grants or scheduler settings change. Existing ownership/security-definer/search-path properties are retained by replaying the canonical function definition. The DO statement is atomic; drift raises an exception before replacement.

Before staging application, verify linked project `oznjmliqnczotunksafx`, migration ledger through `20261016020000`, matching baseline hash, checkout creation disabled, and the reservation-expiry job still inactive. Use the existing tracked Supabase migration workflow. Never enable checkout or change the job to make a smoke test pass.

Isolated application verification must include: BEGIN → migration → ROLLBACK with exact function/ACL/owner equality; committed application with only the reservation definition changing; deterministic lock-wait expiry rejection; normal last-ticket contention and exact retries; eligibility/permission suites. Save the original function definition privately as a recovery artifact before staging application. No production snapshots or credentials belong in Git.

Rollback is a new reviewed forward migration that restores the captured original definition, guarded against the installed Task 6A hash (`583be4d60b932746d0c15be77d366c63`). Recheck the hash against the actual applied definition before use; do not overwrite later changes. Restoration is transactional and changes no data. Keep migration history truthful via the existing migration repair/forward migration workflow; do not silently delete a ledger entry. Frontend rollback uses the previously verified staging frontend deployment. Existing committed orders, payments, tickets and refunds must remain untouched.

Returning to the old function would reopen the demonstrated late-admission race, so prefer disabling new checkout admissions through its existing separately authorized operational process or a reviewed forward fix if the new guard itself causes a regression. Task 6A does not authorize changing operational gate or scheduler configuration during deployment.
