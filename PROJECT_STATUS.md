# Project status

Updated: 2026-09-20. Scaffold version: **0.3.0** (root package.json is authoritative).

## Delivery state

The current working tree prepares the 0.3.0 release and is locally verified on macOS. Completed PRDs have been retired; this file records current evidence without implying a commit, push, tag, hosted release, remote CI pass, merge or deployment.

| Requirement | Implemented behavior / evidence |
| --- | --- |
| Contract | Shared ts-rest/Zod routes, request and response validation, compile-time response regression and actual client-to-Hono CRUD test. |
| Requests/errors | Central client cancellation/timeouts, safe correlated errors, request-only 400 classification, internal failures 500, API and page 404. |
| Examples | Injected isolated memory repository; stream recipe handles framing, cancellation and one user-message write per send. |
| Configuration | Validated hosts, ports, log level and `APP_DATA_DIR`; environment overrides `.env`; local defaults stay on loopback. |
| Durable settings | Versioned application/document identity, sequential migrations, import preview, exact-byte backup, atomic replacement, validation and rollback. |
| Verification | Real ESLint boundaries, types, script and interaction tests, generated frozen installation, managed and foreground runtime checks. |
| Business loop | Native React list/create/edit/delete with loading, empty, error and retry states; independent UI and Query recipes. |
| Layout | Lazy route configuration, error boundary, keyboard interaction, skip link, responsive layout and expansion guidance. |
| Generation | Transactional initializer/reconfiguration, generated application-specific `AGENTS.md`, maintainer artifact removal, fresh pending validation status and upgrade guide. |
| Health | Live/ready/status, required versus optional dependency failures, bounded/coalesced checks, build/instance identity and whole-app diagnostics. |
| Service management | Strict service manifest, foreground owner, managed lifecycle JSON, effective endpoints and a shared cross-process operation lock. |
| Logs | Shared safe NDJSON events, bounded queue/files/retention, rotation/retry, failure visibility, bounded queries and dry-run archive cleanup. |

## Verification record

- `pnpm verify`: passed; 34 Node script tests and 33 workspace tests, plus compile-time contract assertions, lint, types, build and repository checks.
- Clean generated project: frozen install, full verification, managed start/smoke, actual proxy CRUD, deliberately mismatched build rejection, graceful stop, restart identity change, owned child-exit cleanup, foreground readiness and SIGTERM shutdown passed.
- Independent UI, Query and stream recipe copies: installation, full verification and frozen reinstall passed. Default installation contains none of their optional dependencies.
- Browser rehearsal: create/edit with keyboard, page 404 and 320 px viewport without horizontal overflow passed. Temporary browser tab and the owned rehearsal service were closed.
- Default dependency installation was rebuilt with the frozen lockfile. Default production JS has no chunk above Vite's 500 kB warning threshold.
- Existing default-port service was left untouched; runtime rehearsals used isolated ports.

## Remaining external checks and limits

- Ubuntu, Windows and macOS CI matrix is configured; actual remote runner results are pending. Local evidence is macOS only, and no actual Docker image run is claimed.
- Memory storage is intentionally nonpersistent. Vite preview is the local managed WebUI runtime. SQLite, production authentication and other P2 work require separate scope.
- UI recipe intentionally adds a large Ant Design chunk; its cost is isolated from the default base.
- Failed temporary verification copies and historical runtime logs are retained for inspection; they are not release artifacts. No unrelated workspace cleanup was performed.

## Knowledge closeout

| Surface | State |
| --- | --- |
| Code | changed-and-verified — 0.3.0 implementation and regression checks |
| Runtime | changed-and-verified — isolated generated and browser rehearsals; owned services stopped |
| Docs | changed-and-verified — README, operations, migration and implementation record synchronized |
| Rules | verified-current — AGENTS.md matches package boundaries and release gates |
| Memory | not-applicable — no external agent memory changes authorized or needed |
| Workspace | verified-current — repository policy and `verify:push` exclude local configuration, logs, data and uncommitted residue from release pushes |
