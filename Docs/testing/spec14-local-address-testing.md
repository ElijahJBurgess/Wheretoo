# Address testing in an ordinary local browser

The production application still requires selection of a verified California address. Typing text alone never verifies a location.

For the isolated Spec 14 server at `http://127.0.0.1:3040`:

1. Keep your existing Create Event tab open.
2. In a new tab in the **same browser/profile**, open `http://127.0.0.1:3040/__spec14/address-testing`.
3. Click **Enable local address simulator** and wait for the ready message.
4. Return to Date & Location. Clear/retype your search, then select **1 Market Street** from the suggestions.
5. Confirm **Verified address** appears and press **Continue**.

Use the same hostname as your event tab. If it uses `localhost:3040`, open `http://localhost:3040/__spec14/address-testing` instead; browser workers are scoped to one origin.

Normal test input returns that fixed San Francisco fixture, rather than converting arbitrary input into a verified address. Its address, California/US region, postal code, stable feature ID, latitude and longitude come from the same fixture as the existing manual-launcher simulator. The unchanged application normalizes and validates the retrieve response.

The setup page registers an address-only service worker on this task's loopback origin. It can attach to existing tabs without resetting or saving their drafts. It supplies Search Box suggest/retrieve responses and absorbs Mapbox telemetry locally; it does not intercept Auth, event writes, payments or map tiles. Unknown address identities fail. The setup page can unregister it; close/reload this origin's tabs to stop an already active worker.

No script is added to the application bundle, no production CSP is changed, and no runtime feature flag is enabled in staging/production. These tools are served only by `tests/integration/spec14-app.py`, with fixed loopback Host and task checks. Other providers still require the guarded manual launcher; this page is not a general-purpose provider simulator.

## Focused verification

- `node --test tests/e2e/spec14-address-simulator.test.cjs tests/e2e/spec14-manual.test.cjs`
- `node tests/e2e/spec14-address.browser.cjs` against the running task. This uses an ordinary Chromium context with the actual service worker and no Playwright provider responses. It blocks external traffic, uses the existing local organizer, proves typed-only rejection then selection and Continue, and preserves one named unpublished test draft. A rerun resumes that same draft; no reset or publication occurs.

The immutable Gate B package describes the preceding source freeze. This tooling follow-up has its own source identity and local evidence under `.superpowers/spec14/address-testing-fix/`; do not relabel the earlier package as testing these changed bytes.
