# Event Creation Experience Cleanup V1

Baseline: `4a406fcee0098a7ac95b153de99c6039cafd49bc`; branch `codex/event-creation-experience-v1`. Founder delegates ordinary UX decisions and requests immediate implementation after self-review. Build + Prove only; no commit/push/deploy/provider calls.

## Existing truth

Creation uses EventEditorPage: basics → date-location → ticket-type → optional ticket route → details (requirements/agreement) → preview → confirm → outcome. EventCreationLayout displays eight dots. Internal step query parameters preserve resume behavior. New drafts use existing insert; saved edits use context-token conditional RPC and identity fences. Continue saves before advancing; Save draft displays a saved state; back retains form state; dirty navigation prompts. Published events use the existing editor rather than creation layout.

EventImageManager appears in basics and again in details/review, and inline in normal editing. Upload validates JPEG/PNG/WebP and 5 MB, creates a draft if necessary, then uses revision-fenced canonical cover replacement. AI chooser uses existing private generation/three candidate state and explicit selection. Existing generations force an expanded chooser. Position 1 is the canonical cover; no second store is needed.

Schedule uses two datetime-local inputs bound to startsAt/endsAt wall strings. event.time converts America/Los_Angeles independent of browser timezone, rejects nonexistent/calendar-invalid values, and chooses the earlier ambiguous occurrence. Existing minute-only rehydration can lose seconds or the later ambiguous instant when serializing untouched saved values; preserve the exact baseline instant when the displayed wall string is unchanged. New/changed input retains existing conversion semantics.

Mapbox Search Box suggest/retrieve runs through normalizeSearchResult, retaining feature ID, postal, region/country and coordinates. A verified result currently shows both read-only search input and a separate verified block. Clear invalidates canonical location and aborts outstanding requests. Manual text never supplies canonical location. Draft may omit location; publish requires a verified Bay Area California location.

Free capacity is optional. Paid uses the existing tier editor (up to three), save path and readiness guards. Requirements need explicit answers, current policies and revision-bound acceptance. Publication/status remain the recently merged implementation.

## Proposed composition

Four visible stages: Details → When & Where → Admission → Review. Retain internal route/step identifiers; map ticket tiers to Admission and requirements/preview/confirmation/outcome to Review. Use visible labels and aria-current, not eight anonymous dots. Existing editor stays an editor.

Details contains basics and compact optional Event image: proportional thumbnail/placeholder and Upload image / Generate with AI. Keep existing upload operations. AI lives in a dismissible compact panel, opened only deliberately; successful selection closes it. Save current basics before preparing AI, including a new draft, without advancing the wizard or generating automatically. Existing generation candidates remain recoverable when reopened. Normal editing shows a compact image and Change image action; expanded image controls are deliberate. Review uses a read-only cover, title/description/category/schedule/location/admission summary, not another flyer manager.

When & Where presents Start and End fieldsets, each with native Date and Time inputs and Pacific Time shown once. Controls compose the same wall strings; incomplete halves cannot silently persist as a complete time. Do not invent a default end or change DST policy. Save unchanged values with exact baseline instants, including seconds and later ambiguous timestamps. No time-zone selector.

Location shows Venue and Address. Verified state shows one compact address block with Change; no duplicate read-only search field. Change immediately invalidates old canonical location and focuses search; typing/failed retrieval never restores it. Add explicit searching/no-results/retry feedback without raw diagnostics. Preserve request identity and abort behavior.

## Visual and accessibility

Retain existing dark organizer palette (#070c12 canvas, #101720 surface, #f9f7ff text, #b3b4c5 muted, #7544ff accent) and current typefaces. Signature is the four-label progress strip. Desktop readable form width around 800px with paired schedule groups; mobile single-column groups with fitting date/time controls. Remove forced viewport/minimum heights and oversized image/drop zones. Keep focus/error association, native controls, keyboard combobox and reachable actions; no global restyling.

## Constraints and proof

No migration or backend implementation changes. No payment, moderation, ownership, duplicate/import or public projection changes. Existing serializers/conditional RPCs remain authority. Inject local Mapbox/AI/storage transports only for browser proof. No real email, legal acceptance, hosted writes or live providers. Local synthetic accepted policy fixtures may prove publish.

Tests cover four-stage semantics; compact edit/image/AI selected/error behavior; partial date/time, DST, exact unchanged timestamps/location, changed inputs; verified/search/no-result/error/change location; new free/paid, tiers, draft back/reload; existing free/paid/published/duplicate/import events. Run full frontend/functions/typechecks/lint/build; no invented SQL inventory since backend remains unchanged. Browser journeys at 390/1440 with inspected screenshots. One final independent review; leave all changes uncommitted.

Self-review: prefer composition over rebuilding wizard, inline image panel over new storage/editor, native split inputs over a date library. Risks are partial input loss, image identity during first save, reopened AI requests, and dirty back navigation. Tests specifically pin those boundaries. No founder-level contradiction identified.
