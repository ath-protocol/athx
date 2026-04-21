# Agent instructions

## Cursor Cloud specific instructions

This repo is the standalone `athx` CLI. It depends on `@ath-protocol/{types,client,server}` (from `ath-protocol/typescript-sdk`) and, for e2e tests, `ath-protocol/gateway`.

- Install + build: use `pnpm install`, `pnpm build`. The existing update script vendors the SDK packages into `packages/` and writes `pnpm-workspace.yaml` so `workspace:*` resolves locally.
- Tests are split:
  - `pnpm test` runs unit tests in `test/unit/` (no external services; this is the default Vitest scope, see `vitest.config.ts`).
  - `pnpm test:e2e` runs `test/e2e/e2e.test.ts` and requires `ath-protocol/gateway` sources to be available at `packages/gateway/` and `packages/mock-oauth/`. The update script does NOT set this up; check out / vendor the gateway repo manually before running e2e.
- The e2e suite imports gateway internals (`agentStore`, `tokenStore`, etc.) via relative paths. If those imports break after a gateway upgrade, update them in `test/e2e/e2e.test.ts` rather than patching the gateway.
- `dist/cli/main.js` is the built CLI entrypoint. `pnpm dev -- <args>` runs the same CLI through `tsx` without a build step.
- Config (`~/.athx/config.json`) and credentials (`~/.athx/credentials.json`) are stored under `$HOME`/`$XDG_CONFIG_HOME`. Override `HOME` / `XDG_CONFIG_HOME` to sandbox test runs.
- The `zero-review` plugin (https://github.com/A7um/zero-review) is cloned to `/home/ubuntu/zero-review` and symlinked into `/home/ubuntu/.cursor/plugins/local/zero-review` by the update script. Its skills (`auto-dev`, `auto-req`, `auto-test`, `auto-triage`) and role docs (`roles/*/SOUL.md`, `roles/*/AGENTS.md`) are available to read when a task calls for the corresponding paradigm (e.g. `skills/auto-dev/paradigms/bugfix/hypothesis-driven.md` for bug fixes). Cursor loads plugins at session start, so a full activation only takes effect on the next Cloud Agent run.
