# Core Ticket Truth Lite execution preflight

Refreshed 2026-09-08 before Task 1. Latest explicit implementation request supersedes the historical planning-only text and integration assumptions in the approved plan.

- Integration base: local main `04d079c2063c9d89853d989737783906b58a3097`. Checkout Integrity `4814d42` is an ancestor.
- Isolated execution branch: `codex/core-ticket-truth-lite-1`. Main's unrelated Visual Reference deletions/untracked assets remain untouched.
- Local and linked migration head: `20260902010600`.
- Fulfillment: `server_fulfill_paid_order` / `private.fulfill_paid_order`, 16 arguments `(text,uuid,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,text)`, returning `order_id, order_status, ticket_count`. Preserve the final cart-only implementation; no legacy overload or digest restoration.
- Tickets currently use random UUID identity and purchased source fields; statuses `valid/refunded/cancelled`, with issuance/refund/cancellation timestamps. Lite adds only its three planned columns and `used` status.
- Refund: `server_apply_verified_refund`, latest private wrapper migration `20260902010475`. Review: `mark_checkout_reconciliation_review` and `mark_payment_requires_review`. Dispute: `server_apply_verified_dispute` / `private.apply_verified_dispute`; retain legacy invalidation compatibility.
- Ticket Experience shells are not in main. Required committed code is available at `6ec5a513406efd9a29c5bcd1c4b8533c541727d1` on `codex/ticket-experience-shells-1`. Task 6 will port necessary committed files without merging or absorbing unrelated work.
- Read-only linked preflight: development environment, zero ticket rows, zero in-flight orders, checkout disabled. No existing tickets were deleted or changed.

## Narrow execution amendments

Update every fulfillment caller when replacing the signature and regenerate types as each RPC changes. Preserve used history and coherent cancelled-event paid retries. Redemption checks event end server-side and never locks a foreign-event ticket under the requested event lock. Test existing valid-only invalidation before replacing function bodies. Parameterize the shell fixture contracts for paid-only production access and the reused confirmation bearer. Preserve fixture exclusion from production.

Local implementation and verification proceed continuously. Linked migrations, function deployment, secret configuration, and real shared-environment proof require owner approval at that boundary; no push or merge is authorized. The full paid launch proof remains mandatory before claiming completion.

The task/review recovery ledger is retained under `.superpowers/sdd/2026-09-07-core-ticket-truth-lite-implementation/progress.md` in this worktree.
