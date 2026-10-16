# Task 3 approved implementation plan

Baseline origin/main 5ddfb1a (PR #20). Approval: user's Task 3 Implementation request, all four audited changes. Worktree reused on codex/map-event-journey; unrelated primary work untouched.

1. Add failing navigation validation/restore, chooser focus and event presentation tests.
2. Preserve only a validated public map camera/selection/chooser navigation snapshot in existing browser/React Router history. Reconcile IDs with fresh live inventory; restore no event records. Carry public return context through event/tickets/RSVP navigation, retaining existing discovery filters/scroll. Do not alter event URLs, caching, SQL or eligibility.
3. Expose existing paged chooser through one keyboard-accessible control, focus its heading/selected rows and preview, restore focus on Back/Close/Escape. No DOM markers or event feed.
4. Promote existing ticket/RSVP entry before full description, make ticket quantity landing intentional, and use current no-artwork layout after cover failures. Preserve pricing/availability/cart/transaction logic and existing direct links.
5. Run focused and full application checks, browser desktop/mobile regression and before/after measurements; inspect actual diff and obtain independent review. Merge PR and use only verified staging workflow, suppressing branch previews. No Task 4.

Risks: history navigation must not become event authority; stale/failed return requests must not restore old selection. Focus must not pan or scroll the map, and history replacement must not remount it or erase discovery scroll/filter state. Ticket quantity URL updates must carry return context. No database or payment modifications.

## Ledger

- Latest main verified; audited current architecture and shared UI/router conventions. Existing map initialization effect is container-only and will stay so. User has already authorized merge/staging deployment after checks.
- Implemented validated per-entry map navigation hints, fresh inventory reconciliation, public return-state propagation, keyboard chooser/focus lifecycle, ticket landing and failed-cover fallback. No event records are persisted; no cache/API/SQL/icon-budget changes.
- Ruling: retain an existing valid quantity URL when following Get tickets — a regression test exposed the draft being discarded on that transition; cart validation and checkout rules remain unchanged.
- Ruling: if fresh inventory disables the chooser trigger, restore focus to the canvas — failing/green regression proves the body-focus edge case is covered.
- Whole-branch independent read-only review completed, including the subsequent focus fallback, with no important findings.
- Full application suite: 258 files / 2,081 tests passed. Additional final focus/navigation run: 23 tests passed. Intentional public-event markup snapshot updated through the existing generator (only that screen changed).
- Browser fixture verification covers desktop/mobile camera, selected ID, paid cart/quantity landing, keyboard Back/Escape, free RSVP return, unavailable/expired selection, broken covers, sold-out state and embedded Discovery filters/scroll. One native Chromium session closed before rendering; the isolated unchanged case passed in 7.9s. Earlier harness assertion/fixture mistakes were corrected, not production contracts.
- Branch deployment explicitly disabled in vercel.json so GitHub merge can deploy only through the existing main/staging integration. No staging writes, new environments or migrations.
