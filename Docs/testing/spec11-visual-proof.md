# Spec 11 visual proof

Target: the isolated Spec 11 worktree's Vite **production entry/build**, served at loopback port 3031 by `playwright.spec11.config.ts`. Auth/Connect responses are mocked and non-local network is blocked; organizer reads/profile saves execute against the dedicated identity-checked database. Configured-destination proof uses a separate `/tmp/wheretoo-spec11-configured` build with explicitly synthetic `.invalid` destinations, never production configuration.

Source/artifact identity: [Spec 11 incremental diff](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/incremental.diff>) and [production artifact SHA-256 manifest](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/production-artifact-manifest.json>). No deployment freshness claim is made.

Six routes were captured at 320, 390, 768, 1440 CSS pixels with device scale 1, fonts ready, animation disabled and horizontal document overflow checked. Desktop uses the existing dark operations rail with Settings selected and a Settings section list. At mobile widths, detail pages hide the section list and provide a visible Back to Settings link. All 24 route captures were inspected, plus configured Help/Legal, manual closure confirmation and the empty password editor. Typography, name/bio wrapping, controls, count labels and private preview remained readable. The adjacent Account/closure action spacing was adjusted after inspection.

This is local Chromium browser proof, not a physical-device or assistive-technology conformance claim. The standalone visual-audit CLI cannot inherit this app's route-bound Auth/HTTP fixtures; the canonical Playwright harness supplies authenticated state, viewport/overflow assertions and captures instead. Camera hardware and provider screens remain separate gates.

## 320px routes

- [index](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/index-320.png>)
- [account](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/account-320.png>)
- [profile](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/profile-320.png>)
- [payments](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/payments-320.png>)
- [help](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/help-320.png>)
- [actions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/actions-320.png>)
## 390px routes

- [index](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/index-390.png>)
- [account](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/account-390.png>)
- [profile](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/profile-390.png>)
- [payments](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/payments-390.png>)
- [help](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/help-390.png>)
- [actions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/actions-390.png>)
## 768px routes

- [index](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/index-768.png>)
- [account](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/account-768.png>)
- [profile](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/profile-768.png>)
- [payments](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/payments-768.png>)
- [help](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/help-768.png>)
- [actions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/actions-768.png>)
## 1440px routes

- [index](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/index-1440.png>)
- [account](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/account-1440.png>)
- [profile](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/profile-1440.png>)
- [payments](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/payments-1440.png>)
- [help](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/help-1440.png>)
- [actions](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/actions-1440.png>)

## Configured states

- [help-configured-390](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/help-configured-390.png>)
- [closure-confirm-390](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/closure-confirm-390.png>)
- [password-empty-390](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/password-empty-390.png>)

![Organizer Profile, 390px](</Users/exoh/Desktop/WhereTo -  Repository/.worktrees/spec11-organizer-settings/.superpowers/spec11/visual/profile-390.png>)
