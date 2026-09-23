# AI Event Cover Phase 2 — implementation and rollout

Date: 2026-09-22. Worktree: `/Users/exoh/Desktop/WhereTo-ai-event-cover`. Branch: `codex/ai-event-cover`. Phase 1 remains the canonical attachment and selection contract. Both phases remain uncommitted locally.

## Provider/model actually used

The production adapter is OpenAI Image API `POST https://api.openai.com/v1/images/generations`, pinned to `gpt-image-2.5-flare-2026-09-08`. Each request uses `n: 1`, `size: "1024x1280"`, `quality: "medium"`, `output_format: "png"`, `background: "opaque"`, and `moderation: "auto"`. It decodes `data[0].b64_json`, validates the PNG container, checks exact dimensions, and rejects payloads over the existing 5 MiB image limit. No SDK retries or URL downloads are used.

No approved pinned model was present in the checked-in Phase 1 plan. Current official documentation recommends GPT Image 2.5 for new integrations and describes Flare as the faster option. The API explicitly supports this snapshot and custom dimensions. 1024×1280 is native 4:5 and meets the documented size constraints; no crop or image-processing dependency is needed. [Image guide](https://developers.openai.com/api/docs/guides/image-generation), [request/response reference](https://developers.openai.com/api/reference/resources/images/methods/generate), [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

Current rates are $5 per million text input tokens and $30 per million image output tokens. This workflow has no image inputs. Actual per-image cost depends on token consumption; there is no asserted flat price per cover. Documentation lists Tier 1 at 5 images/minute and 100,000 tokens/minute, with free API access unsupported. Account entitlement and actual limits have not been verified. The application does not assume that organizer quotas replace project-wide provider limits. [Pricing](https://developers.openai.com/api/docs/pricing), [model rate limits](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare).

All local provider execution was mocked. The adapter's HTTP request, successful base64 response, malformed payload, aspect ratio, moderation, quota, rate-limit and timeout behavior were tested without a credential. No paid request or hosted secret was used. Live visual quality, account availability and real latency remain rollout checks.

## Prompt strategy

The database freezes saved title, description (first 2,000 characters), category, city, venue and local time-of-day. It does not include the structured address, prices or date. Organizer input is a mood enum and up to 300 characters of creative direction. The server supplies three distinct treatments: cinematic editorial scene, expressive illustration and conceptual still life. Each prompt prioritizes a 4:5 focal composition and thumbnail readability. Saved free text is labeled as descriptive data, not instructions. Prompts forbid artwork text, lettering, typography, dates, addresses, ticket prices, logos, watermarks and flyer borders. Provider moderation stays enabled. Prompt instructions do not guarantee text-free or visually distinct outputs; organizers review the candidates before selection.

## Backend changes

New migration: `supabase/migrations/20260922020000_add_ai_cover_generation.sql`.

It extends the existing generation/candidate tables with a frozen context, expiration, activity deadline, attempt count, claim token and lease, plus durable cleanup receipts. A private configuration row controls daily limits and retention. The original create RPC now validates input, serializes organizer quotas, snapshots the event, and preserves payload-checked request deduplication. Empty saved titles fail before consuming a set.

The new `event-cover-generation` Edge endpoint verifies JWT identity through Auth and requires the configured application origin. It supports:

- `start`: event ID, displayed revision, stable request UUID, mood and direction. Returns three persistent slots.
- `state`: owner-only state recovery and bounded private retention cleanup.
- `step`: generation ID, slot and observed attempt number. Claims at most one provider attempt before calling OpenAI. Duplicate submissions cannot claim a second execution.

The browser receives no provider key or service-role capability. Service RPCs are restricted to the backend. New metadata remains private. Supabase function gateway JWT verification is disabled consistently with existing functions, but every operation validates the bearer token in the handler. Runtime configuration is explicitly fail-closed unless `AI_COVER_ENABLED=true` and `OPENAI_API_KEY` are present.

Generation never attaches a public image. “Use this cover” still calls the Phase 1 `event-images` mutation. The Phase 2 selection guard adds candidate-expiry rejection; canonical attachment switching, revision increments, ownership and idempotent selection receipts retain their Phase 1 semantics.

## Frontend changes

`AiCoverChooser` sits inside the existing `EventImageManager`, reusing its form/button styling. It includes Generate with AI, nine moods, optional direction, progress, three private signed previews, partial failure, one-candidate retry, regenerate and Use this cover. Saved input and candidates restore on reopen. Unstarted slots resume sequentially; an interrupted attempt requires explicit retry. The signed previews refresh before expiration. Queries are scoped to the authenticated identity and the existing private cache family.

Unsaved drafts show save-first guidance. Generation explicitly uses saved event details. Manual upload/replace/remove remain available; the original upload UI is unchanged. Stale options are disabled and cannot bypass server revision checks. No flyer editor, typography tools, exports, reference uploads or unrelated redesign was added.

## Limits and failure/retry behavior

Defaults in `private.event_cover_limits`:

| Control | Default |
| --- | --- |
| Sets per event / UTC day | 3 |
| Sets per organizer / UTC day | 10 |
| Active sets per organizer | 1, enforced across events |
| Provider attempts per candidate | 2 total: original plus one explicit retry |
| Retry cooldown | 15 seconds |
| Provider HTTP timeout | 110 seconds |
| Attempt lease | 140 seconds |
| Abandoned set activity deadline | 15 minutes |
| Candidate retention | 7 days |

Each request runs one candidate; the browser advances the three slots. The provider timeout leaves room within Supabase's documented 150-second request idle limit. This is a request-driven flow, not an always-running job: closing the page may interrupt current work and delays unstarted slots until reopen. [Supabase runtime limits](https://supabase.com/docs/guides/functions/limits).

Successful candidates survive sibling failures. Retryable codes cover provider timeout, transient failure/rate limit, Storage failure and invalid output. Moderation, quota/auth and invalid-provider-request failures are not automatically retried. Regeneration consumes a new set; the maximum is six provider attempts per set. If a request is aborted or its response is lost, OpenAI may still bill it; no provider idempotency guarantee is assumed.

Claims fence late completions. Reload recovers already-uploaded deterministic PNGs without provider spend or increasing attempts, including after the final allowed attempt. Only a confirmed Storage 404 allows a provider request; a Storage outage cannot masquerade as missing bytes. If canonical artwork changed or another generation superseded the set, further execution and selection fail stale.

## Retention and limitations

Candidate access and selection expire at the stored deadline. Previously issued preview links may remain valid for their remaining 60-second lifetime. Owner requests clean up at most 10 expired sets using the Storage API, with durable receipts so failed deletion is retried. Inactive organizers' expired bytes may remain stored until subsequent activity; there is no guarantee of deletion at precisely seven days and no permanent cleanup worker. Selected canonical copies are separate and survive candidate retention. Phase 1 orphan canonical-stage cleanup remains its documented operational debt.

## Exact hosted rollout requirements — not performed

1. Review and package both uncommitted phases. Apply Phase 1 migration `20260922010000_add_ai_event_cover_foundation.sql` if absent, followed by Phase 2 migration `20260922020000_add_ai_cover_generation.sql`. Do not edit hosted tables ad hoc. Review the seeded private quota/retention values; alter them only through an approved migration/admin operation.
2. Deploy the updated Phase 1 `event-images` function and the new production `supabase/functions/event-cover-generation/index.ts` with its provider/Storage helpers. Deploy from the repository source, never `.supabase/ai-cover` or the mock template. Keep the function config's `verify_jwt=false`; the handler performs explicit Auth verification.
3. Configure a server-only OpenAI project key as `OPENAI_API_KEY` after explicit authorization. Confirm the pinned Flare model is available to that project, required organization verification is complete, spending/billing limits are set, and image/token rate limits support expected traffic. Do not use a `VITE_` variable or browser key.
4. Verify the existing server-side Supabase URL/service-role configuration and `APP_BASE_URL` match the intended application origin. Preserve current Supabase, Vercel and provider configurations until rollout is authorized. Set `AI_COVER_ENABLED=true` only when provider access and the backend are ready; absent/false leaves generation disabled without changing manual uploads or existing selection.
5. Publish the frontend together with the compatible backend/migrations. Phase 1 intentionally rejects older unversioned mutation clients. No separate public AI bucket, public image endpoint, scheduler or Vercel-specific worker is required.
6. Run an explicitly authorized, low-volume hosted smoke test: generate one set, inspect all three images for relevance, no typography, native 4:5 and thumbnail readability; confirm latency, actual billed usage and project rate limits; retry a controlled failure; test reload, private owner boundaries, selection and manual replacement. Observe Storage retention/recovery and confirm canonical public delivery. Do not claim production readiness solely from mocked local results.

The feature can be disabled with the server flag without deleting candidates or changing the current canonical cover. Existing private state remains reloadable and existing Phase 1 manual cover operations continue.

## Local reproduction and changed files

With Docker and frozen-lockfile dependencies available, run `python3 tests/integration/run-ai-cover-local.py start`, then `reset`, then `serve` in a separate terminal and `test` in the first. The runner creates only the dedicated local `wheretoo-ai-cover-phase1` project (API 56321, DB 56322). Its generation entry is deliberately replaced by the test-only mock template inside the ignored runtime directory. No OpenAI key is needed. Stop with the same runner's `stop` command.

Browser proof: start this worktree's Vite server on `127.0.0.1:3050` using that dedicated local Supabase URL/anonymous key and placeholder Mapbox/Stripe public values, then run `node tests/integration/ai-cover-browser.mjs`. It creates local fixture accounts/events and blocks nonlocal browser requests. Screenshots stay under ignored `.supabase/ai-cover/visual`.

Phase 2 files: the new migration and SQL tests; `supabase/functions/event-cover-generation/{index,provider,candidateStorage,provider.test}.ts`; new frontend chooser/API and tests; small manager, state projection, stylesheet and RPC-type updates; `supabase/config.toml`; local generation/browser/mock test harnesses; this report and the Phase 2 plan. Phase 1 SQL/HTTP fixtures were updated for the shared quotas and saved-title requirement. No dependency or lockfile change was needed.

## Verification results

| Check | Result |
| --- | --- |
| Full migration chain from a fresh local reset | Pass, including both cover migrations |
| SQL assertions | 49 pass: 15 foundation, 17 canonical compatibility, 17 generation |
| Auth/PostgREST/Storage/Edge HTTP checks | 91 pass: 58 Phase 1 regression, 33 generation/recovery |
| Focused frontend tests | 161 pass across 17 files |
| Deno provider, raster and mutation tests | 17 pass |
| Deno type check for both Edge functions | Pass |
| Application typecheck | Pass |
| ESLint | Pass |
| Production build | Pass, 693 modules, local placeholder public configuration |
| Browser journey | Pass: generation, partial failure, retry, reload, mobile selection, manual replacement/removal |
| Independent security/concurrency review | Two recovery findings fixed and re-reviewed; no remaining must-fix findings |
| Diff whitespace check | Pass |

Browser/visual scope: actual local organizer editor route `/organizer/events/:fixtureId/edit?step=basics` at `http://127.0.0.1:3050`, using this worktree's Vite source and the dedicated mock-provider backend. Actor: local fixture organizer. Viewports: 1280×960 and 390×844. Existing EventImageManager styling is the reference. Screenshots of desktop partial failure and mobile ready options were opened and inspected. Portraits fit without cropping or horizontal overflow; the browser reported no runtime errors. Generation inputs and private candidates restore after reload. No hosted delivery claim or live artwork-quality claim is made.

Status: Phase 2 implementation and local verification complete. No OpenAI request, hosted provider secret configuration, hosted Supabase operation, Vercel modification, deployment, push or commit was performed. Work stayed on the requested branch/worktree. The local test services are stopped after verification.
