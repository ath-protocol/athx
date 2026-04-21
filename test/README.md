# athx tests

Two independent suites live here:

## Unit tests — `test/unit/`

- Cover pure modules only (no network, no external services).
- Currently exercise `Config` and `CredentialStore`.
- Run with:

  ```bash
  pnpm test
  ```

This is the default Vitest scope (see `vitest.config.ts`). It is safe to run anywhere and does not depend on any other repo.

## End-to-end tests — `test/e2e/`

- Drive the built `athx` CLI against a real ATH gateway, mock OAuth2 server, and ATH-native service.
- Require external code that is NOT part of this repo:
  - [`ath-protocol/gateway`](https://github.com/ath-protocol/gateway) — reference gateway (contains `vendor/mock-oauth/` as well)
  - [`@ath-protocol/server`](https://github.com/ath-protocol/typescript-sdk) — installed as a dependency
- Expect gateway + mock-oauth sources to be reachable at `packages/gateway/...` and `packages/mock-oauth/...` (see the header of `e2e.test.ts` for the exact import paths).
- Run with:

  ```bash
  pnpm build
  pnpm test:e2e
  ```

If you do not have the gateway checked out / vendored into `packages/`, this suite will fail to load. That is expected — use unit tests for everyday development and opt in to e2e when you are working on protocol-level behavior.
