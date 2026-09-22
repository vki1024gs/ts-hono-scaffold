# Contributor rules

## Mission

This repository is a contract-first TypeScript monorepo scaffold for local WebUI/API applications. The generated project must remain easy to initialize, run, verify, and hand off on Windows, macOS, and Linux.

This file governs the scaffold maintainer checkout only. A first successful
`scripts/init.mjs` run must atomically move its contents to
`.scaffold/SCAFFOLD_MAINTAINER.md` as inactive reference material and replace
the root file with application-specific agent rules. Generated projects must
not treat scaffold release status, maintainer PRDs, recipe maintenance
instructions, or template verification as current project instructions.

## Cold-start contract

- If `.scaffold/project.json` is absent, this is an uninitialized template checkout. Run `node scripts/init.mjs` with an explicit name, scope, API port and WebUI port before installing dependencies.
- If `.scaffold/project.json` exists, this is an initialized application. Do not initialize it again; read its generated `AGENTS.md`, install with the locked package manager, then run `pnpm verify`.
- Initialization happens in the cloned checkout; it does not create a second sibling project directory.
- Before initialization, reusable scaffold guides and recipes have one source under `.scaffold`; `docs/scaffold` must not duplicate them. The initializer creates `.env`, records immutable scaffold lineage, archives this maintainer rule file under `.scaffold`, writes application-only rules at the root, resets project verification to pending, removes maintainer-only PRDs and implementation evidence, and atomically relocates the guide tree to `docs/scaffold`.
- Pulling later scaffold commits into an initialized application is not an automatic upgrade mechanism. Compare and merge code intentionally without overwriting application rules, business code, `.env`, or `APP_DATA_DIR`.

## Repository map

- `packages/core`: framework-free domain types and logic.
- `packages/api`: Zod and ts-rest API contract; change this before server or client code.
- `packages/webui`: Hono HTTP implementation.
- `packages/frontend`: React/Vite WebUI and the centralized API client.
- `packages/db`: injected repository boundary and memory adapter.
- `.scaffold`: the single pre-initialization source for maintainer guidance and independent capability examples; reusable contents relocate to `docs/scaffold` on initialization.
- `scripts`: initialization, lifecycle, build identity, diagnostics, and repository gates.

## Development contract

- Node.js 24+ and pnpm 10.20.0 are required.
- Use repository-owned Node scripts for lifecycle and filesystem work. Do not introduce POSIX-only `cp`, `ps`, `lsof`, shell quoting, or destructive `rm -rf` workflows.
- `.env.example` is the public environment contract. `APP_DATA_DIR` is the single root for machine-local application data; never hard-code runtime storage paths. Never commit `.env`, credentials, databases, logs, local application data, dependencies, or ordinary build output.
- Root `package.json.version` is the release source of truth. Keep all workspace versions and `packages/core/src/version.ts` aligned through `pnpm version:set`.
- Public API changes start in `packages/api/src/contract.ts`, then update the server, centralized frontend client, tests, and README together.
- Frontend components do not call `fetch` directly; add calls in `packages/frontend/src/api/index.ts`.
- Managed start/stop/restart must affect only the current checkout's recorded process tree. Never kill a process because it happens to own a configured port.
- Preserve one lifecycle owner: `app:run` stays foreground for Docker/system service ownership, while `app:start/stop/restart` own the local detached instance. Never nest the local supervisor inside another runtime owner. Keep `service.manifest.json`, package scripts, environment keys, health paths and endpoint roles synchronized through repository tests.
- Keep development dependencies out of the built runtime. Production start must execute the bundled API and repository-owned static server without resolving `node_modules`, TypeScript, tsx, Vite, Vitest, ESLint or Prettier. Preserve `pnpm verify:production` when changing build or lifecycle code.
- Safe build cleanup must preserve `.env` and user data. Destructive local reset is not a routine command.
- Tests and fixtures must be deterministic, compact, offline after dependency installation, and clone-safe.
- Generated-project and recipe verification must remove temporary copies on success and failure. Retention is an explicit one-run diagnostic opt-in through `SCAFFOLD_KEEP_FAILED_VERIFY=1`, never the default.

- API service events use the shared structured logger; never log bodies, raw URLs, credentials or arbitrary error objects.
- Health checks must be bounded and truthful; a 200 or live PID alone is not whole-app health. Preserve log budgets, instance ownership and failure visibility.
- Optional recipe dependencies must not leak into the default base. Generated validation status starts pending.
- Keep the generated-agent template in `scripts/init.mjs` concise and application-oriented. Initialization tests must prove that maintainer-only rules and completed PRDs do not survive first initialization.
- Keep startup configuration in `.env` and `scripts/lib/config.mjs`. Versioned, user-editable data that survives updates belongs in domain modules such as `packages/core/src/settings`; it must remain independent of filesystems, Hono, React, and operating systems. Storage adapters belong in `packages/db`, while transient runtime state stays in lifecycle scripts.
- Give every durable user document a stable application ID, document type and schema version. Add sequential migrations and sanitized historical fixtures before releasing a schema change. Migration/import must preview and fully validate before writing, back up exact prior bytes, replace atomically, verify after replacement and restore on failure. Never reset incompatible data to defaults or let initialization, cleanup, installation, or scaffold upgrades overwrite `APP_DATA_DIR`.
- Extend the existing `createApp(options)` composition factory through explicit injected interfaces. Do not introduce a second application factory, global service locator, or dynamic plugin loader.

## Required checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:production
pnpm verify:repository
```

Run `pnpm verify` before a handoff. For release claims, also prove a frozen install and verification from a clean generated copy or clone. Distinguish implemented, locally verified, CI verified, pushed, merged, and live verified states.

Immediately before pushing a release commit, run `pnpm verify:push` from a clean Git worktree. It must fail on tracked or untracked residue, version drift, repository privacy violations, any ordinary verification failure, or a failed fresh generated-project lifecycle.
