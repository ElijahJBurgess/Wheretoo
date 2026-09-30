# Discovery refinement — founder-approved closeout

This addendum supersedes the original report's full-width feature and omitted-map-slot presentation only. The original Discovery implementation, bridge asset, spec and plan already landed in PR #11 at main `69b35a40448db8f6f67b0ab04044866aaf6600f3`. Remote main has no intervening tree changes. Branch: `codex/discovery-redesign-v1`.

## Approved refinement

- Reuse the existing onboarding wordmark declarations through `platform-brand.css`; remove the standalone purple icon and serif header treatment. Preserve the original onboarding selector/markup and static preview compatibility.
- Keep canonical featured artwork contained in a padded frame, with event details beside it.
- Reserve a separate, noninteractive “Map coming later” panel on the right; stack on mobile. No map controls, fake data or map integration.
- Preserve cinematic bridge hero, filters, canonical event selection/images, poster cards, shortcuts, routing, return state, public eligibility and API contracts.

## Proof

Prior refinement: 48 focused tests and 11 browser journeys PASS; typecheck, lint, build and diff check PASS. Previous governing report records 1,808 frontend tests and 432 function tests PASS. That full Discovery proof remains applicable; no new backend/function changes.

Closeout adds a desktop/mobile onboarding browser check for the exact existing font family, size, weight, letter spacing, color and document reflow. The full-suite static-preview fixture guard exposed unnecessary onboarding markup churn; preserving the legacy selector and sharing CSS fixes it without changing fixture HTML.

Browser proof uses local intercepted fixtures, not hosted provider/data proof. Screenshots live under `.superpowers/discovery-redesign/refinement-visual/`: `desktop-1440.png`, `mobile-390.png`, `onboarding-1440.png`, `onboarding-390.png`. Real map integration remains explicitly deferred and unverified.

Fresh final test/check counts and merge/deployment identity are recorded in the closeout response. No migrations, backend hosting, Stripe/payment changes or unrelated feature work are included. The pre-existing local edit to the original governing report is preserved outside this commit.

Final closeout: 1,809 frontend tests PASS (219 files); 12 browser checks PASS (11 Discovery journeys plus onboarding at both viewports); typecheck/lint/build/diff check PASS. Built bridge GET returned 200 image/jpeg, 346,628 bytes, SHA-256 `73f67551118cdd1a94ac5de6fc45e7f1b93c40ab57133edb9d628069aca856e9`, identical to source. Built onboarding wordmark visually inspected with its original computed styling intact. Independent review clean.
