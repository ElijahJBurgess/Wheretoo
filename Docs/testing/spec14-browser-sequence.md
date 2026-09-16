# Spec 14 — selected browser execution sequence

> **Source-freeze checkpoint:** This source document records the pre-terminal verification state. The delivered detached handoff report and `handoff/evidence-index.json` carry subsequent build/export, Payments rerun and terminal-journey results with their actual identities. Those later results supersede pending checkpoint statuses here. Keeping results detached avoids changing the source bytes that those executions verify.

This is a dependency schedule, not a claim that pending cases passed. Use one exact selected case per command, review its exit/result and close its browser/provider ownership interval before continuing. Do not run the entire file, reset the database/ledger, erase failed attempts, or replay completed financial actions automatically. Resume failed cases only after inspecting their retained canonical request/source and private browser state.

Command shape from the destination worktree:

```sh
umask 077
pnpm exec playwright test --config playwright.spec14.config.ts --grep 'J04b multi-source recovery' > .superpowers/spec14/j04b-browser-resume1.log 2>&1
```

Use the distinct literal grep prefix in the table; each matches one current test. Existing result logs must not be overwritten: choose the next explicit resume suffix. Test file order is not the execution schedule. Stop at each failure; independent cases may continue only after the failed attempt and any global provider mode are accounted for.

| Order | Exact unique grep prefix | Dependency / current state |
|---|---|---|
| 1 | `J01 real signup, profile` | Passed; original organizer, paid draft, publication preserved. |
| 2 | `J02 paid discovery to signed fulfillment` | Passed; original order and Used history. |
| 3 | `J03 free UI event, three admissions` | Passed; original and reverse free sources. |
| 4 | `J03a separate free reader-boundary draft` | Passed; retained unpublished negative draft. Do not blindly rerun its original-paid-only monitor after additional paid-card fixtures exist. |
| 5 | `J02a paid QR first then manual duplicate` | Passed; separate paid source. |
| 6 | `J04 initial receipts, no mount sends` | Passed. Its first-time queued assertions must precede any email worker; do not represent later replay as that initial condition. |
| 7 | `J04a resend uses recorded recipients` | Passed; retained failed/unknown resend attempts. |
| 8 | `J07a unsaved profile and stale version` | Passed before terminal account changes. |
| 9 | `J04b multi-source recovery` | Passed with the existing event after bounded real queue recovery. Additional read-only ticket-ID binding check uses the retained grant; no replacement source or recovery send. |
| 10 | `J06b stale published event inputs` | Passed using the J04b event; stale expected-context write refused. |
| 11 | `J06c postponed saved event` | Passed after both approved moderation repairs; original revision5 evaluated, exact recovery intent accepted through bounded existing-queue drain, same-request readback retained both collections. Earlier failures preserved. |
| 12 | `J06d stale notice review` | Passed stale review rejection, suppression of the superseded unsent notice, and accepted-notice preservation across later publication. |
| 13 | `J08 negative deep links, offline` | Original free collection and ordinary organizer guard; no mutation. |
| 14 | `J08a checkout committed reply loss` | Original paid event must remain sellable; separate retained checkout. |
| 15 | `J08b RSVP lost committed reply` | Original free event sellable; separate retained RSVP. |
| 16 | `J08c provider commits checkout` | Own checkout provider mode exclusively; original retry immediately, before minimum remaining lifetime. |
| 17 | `J08e complete checkout proof loss` | Requires exact J08c result; separate browser receives no original proof. |
| 18 | `J08d verified unpaid cancellation` | Original paid event sellable; separate retained unpaid source. |
| 19 | `J08-admission-paid committed writer reply loss` | Separate paid source, original event still admission eligible. |
| 20 | `J08-admission-free committed writer reply loss` | Separate free source, original event still admission eligible. |
| 21 | `J08f real free admission result survives` | Separate free source; retain actual Admitted result before metrics failure. |
| checkpoint | Independent same-source/visual/Auth checks | The nine scheduled J08 cases above passed. Complete the separate real-data pagination/full runner and original B2 Payments-return fixture before terminal cases. Close all snapshots and provider intervals; B1 and G07 remain paused. |
| 22 | `J05-processing refund boundary` | Separate paid source; restores global refund/email modes. |
| 23 | `J05-failed refund boundary` | Separate paid source; failed operation remains retained. |
| 24 | `J05-anomaly refund boundary` | Separate paid source; review operation remains retained. |
| 25 | `J05-commit_then_unknown refund boundary` | Separate paid source; recover same refund ID, no new dispatch. |
| 26 | `J05 full paid refund uses` | Original paid source becomes refunded; preserve Used row. Needs exact accepted refund notice proof. |
| 27 | `J06 separate terminal datasets` | Creates explicitly separate changesPaid/cancellationFree datasets and cancels those, not original principal free event. Requires original J05 refund as stated by case. |
| 28 | `J06a late signed payment after UI cancellation` | Separate latePayment event/order/session; canonical requires_review with no tickets. |
| 29 | `J04c separate expired and revoked grants` | After real information-only notice exists (J05/J06); reverse original free source remains eligible for separate recovery grant/revocation. |
| 30 | `J04d refunded and cancelled sources refuse` | Requires J05 original refund + J06 cancellationFree registration. |
| 31 | `J07 Settings routes, profile persistence` | LAST: email/password update and global sign-out invalidate old organizer storage; Free B2 and Create legacy checks must already be closed. |

## Stopped branch, excluded from automatic continuation

`J08g unattached original checkout crosses real minimum lifetime` was executed separately after J04a and failed canonically: the original provider session is paid, the original order remains creating_checkout with null session and zero tickets, and the signed receipt is permanently processed with PAYMENT_SNAPSHOT_MISMATCH. It is not scheduled for another ordinary replay. See the UNAPPLIED reconciliation proposal. Any new forward acceptance control requires approved contract work and an explicitly separate name; it cannot overwrite or claim to recover the existing failed receipt.

B1 Auth SDK race remains separately blocked; ordinary single-organizer journeys do not establish its concurrency safety. This schedule does not authorize dependency or handler/schema patches.

## Separate legacy-history control

`node tests/e2e/spec14-j06-legacy-history.cjs` is a separate fixed-fixture runner, not another Playwright prefix. It requires the existing eligible J03 source and an exclusive runtime interval, with no concurrent worker or event-history read. Its current accepted run is `j06-legacy-history-1789458862720/report.json` (SHA-256 `6add8d5a0f26d942ba8355a2dcd5c1dc106e2ba9f96eeb425b68cbd25228a7d9`), with both-origin writer fencing and cleanup verified. The earlier accepted run and its narrower counter limitations remain in the verification record. The real page displayed both unavailable previous versions and correct current saved/public facts. It consumed one normal snapshot sequence value and did not rewind it. This prerequisite is closed before J07; do not rerun it automatically. Main J06 notice/cancellation cases remain separate.
