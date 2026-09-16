# Supabase Auth readiness patch

`auth-js@2.112.3.patch` is the approved local patch for the existing `@supabase/auth-js` version. `pnpm-workspace.yaml` and `pnpm-lock.yaml` bind it. No package version changes.

The patch keeps `data.subscription` compatible and adds `ready: Promise<{ error: Error | null }>` to `onAuthStateChange`. It awaits the initial session emission inside the existing custom lock, catches outer initialization/lock/propagated callback failures, removes the failed subscription, and fulfills readiness with the error. It does not change global logout scope or introduce storage repair. The application waits for readiness and displays a fixed Auth-unavailable state on failure.

The nine patched files are the maintained `src/GoTrueClient.ts`, CommonJS and ESM JavaScript/declarations, and their four source maps. The emitted outputs were regenerated with installed TypeScript 6.0.3, ES2017 target, CommonJS/ESNext modules, declaration/declarationMap/sourceMap enabled, esModuleInterop/importHelpers enabled, and useDefineForClassFields disabled. These options first reproduced all eight unpatched published outputs byte-for-byte. The modified source then generated the approved JS/declaration postimages and new maps; maps were not edited by hand.

Focused offline checks:

```sh
node --test tests/e2e/spec14-auth-dependency.test.cjs
node --test tests/e2e/spec14-auth-distribution.test.cjs
node tests/e2e/spec14-auth.browser.cjs
node tests/e2e/spec14-signout-completion.browser.cjs
```

The distribution test regenerates in memory. Upstream source was authored against TypeScript 5.8's DOM library; the installed TypeScript 6 DOM introduces an existing `PublicKeyCredentialFuture` extension incompatibility in `src/lib/webauthn.dom.ts`. The same diagnostic occurs before and after this patch. The test rejects additional diagnostics and verifies exact emission, but does not claim a passing full upstream source typecheck. Application/declaration typechecks are separate.

The two browser scripts use actual Chromium tabs and the installed SDK/application modules with fully intercepted synthetic Auth responses. They never use the principal local journey or real external Auth. Real local Auth service integration, when run, has separate evidence and users.
