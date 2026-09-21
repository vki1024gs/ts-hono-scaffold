# TypeScript / Hono scaffold

A contract-first local application scaffold: Hono, React/Vite and pnpm workspaces. The default application is a complete memory-backed CRUD example with a typed client, accessible controls, error recovery, health diagnostics and bounded structured logs. Application release version is **0.3.1**; the root package manifest is its source of truth.

## 中文快速开始（0.3.1）

这是一个用于本地 WebUI/API 应用的 TypeScript 全栈脚手架。默认提供可运行的增删改查页面、类型化 API、健康诊断和结构化日志；数据保存在内存中，**重启后清空**。

### 1. 准备环境并创建自己的项目

安装 Git、Node.js **24 或更高版本**和 pnpm **10.20.0**。已有 Node.js 时可安装指定 pnpm：

```sh
npm install --global pnpm@10.20.0
node --version
pnpm --version
```

在准备存放项目的目录执行以下命令。初始化不依赖 node_modules，必须先初始化再安装依赖：

```sh
git clone https://github.com/vki1024gs/ts-hono-scaffold.git my-project
cd my-project
node scripts/init.mjs --name my-project --scope @my-project --backend-port 18080 --frontend-port 2711
pnpm install --frozen-lockfile
pnpm verify
pnpm app:start
```

把 `my-project`、`@my-project` 换成你的项目名和包作用域。初始化会生成 `.env` 并同步包名与端口。复制生成的项目仍保留原 Git 远端；开始向自己的仓库提交前，使用 `git remote set-url origin <你的仓库地址>` 修改远端。

冷启动不会在旁边再生成一套项目：克隆目录本身会被原子转换为你的应用。初始化完成后，原脚手架 `AGENTS.md` 会移到 `.scaffold/SCAFFOLD_MAINTAINER.md` 作为非活动溯源资料，根目录生成该应用自己的 `AGENTS.md`；脚手架维护者 PRD、实现验收记录和可选 recipes 会被移除，项目验证状态重新从 pending 开始。以后拉取脚手架提交不等于自动升级，必须比较后有选择地合并。

如果只想运行脚手架本身，在克隆后跳过 `node scripts/init.mjs ...`，直接安装、验证、启动即可。维护脚手架的原始工作目录不要执行项目初始化。

### 2. 打开页面并使用

启动成功后打开 `http://127.0.0.1:2711`，输入名称创建条目，在列表中编辑或删除。API 地址为 `http://127.0.0.1:18080/api/items`，诊断地址为 `http://127.0.0.1:18080/status`。自定义端口后，请使用对应的新地址。

```sh
pnpm app:status
pnpm smoke
pnpm app:logs
pnpm app:stop
```

`app:start` 会先构建，再后台启动；`app:stop` 停止当前项目管理的实例。修改代码后可执行 `pnpm app:restart` 重新构建并启动。首次安装需要联网，命令都在项目根目录运行。

### 3. 日常开发

先停止后台实例，再启动前台开发模式，避免端口冲突：

```sh
pnpm app:stop
pnpm dev
```

开发时在页面查看修改，完成后按 `Ctrl+C` 退出。`pnpm dev:api` / `pnpm dev:web` 可分别启动两端。开发前台进程由当前终端管理；`app:stop` 用于后台托管实例。

新增功能按 `packages/api` 契约 → `packages/webui` 实现 → `packages/frontend/src/api` 客户端 → 页面与测试的顺序修改。默认 CRUD 页面在 `packages/frontend/src/pages/HomePage.tsx`，存储接口在 `packages/db`。提交前运行 `pnpm verify`。

### 4. 常见配置与排查

- **端口占用**：先停止当前项目的旧实例，或在 `.env` 修改 `PORT` / `VITE_PORT` 后重启。两者不能相同；脚本不会终止占用端口的其他程序。
- **启动失败或页面不可用**：依次运行 `pnpm doctor`、`pnpm app:status`、`pnpm app:logs`。`pnpm smoke` 同时检查 API、前端资源和构建身份。
- **页面标题**：修改 `.env` 中的 `VITE_APP_TITLE` 后重新构建或重启开发模式。
- **定位请求错误**：用响应的 `X-Request-Id` 查询 `node scripts/app.mjs logs --request-id REQUEST_ID`；日志文件位于应用数据目录的 `logs/`。
- **清理日志**：先执行 `node scripts/app.mjs logs-clean --dry-run` 预览，再按需使用 `--apply`。不会删除正在写入的日志。
- **需要数据库、登录或复杂 UI**：默认没有持久化或正式认证；按自己的业务接入。独立 UI、Query、stream 示例见 `.scaffold/recipes`，初始化时会移除这些维护者示例，接入前从对应脚手架版本获取。

0.3.1 在既有契约、CRUD、健康、日志和配置迁移基础上，补齐跨平台换行与格式门禁、真正的生产构建产物，以及不依赖 `node_modules` 或开发依赖的运行验证。详细运维说明见 [OPERATIONS.md](docs/OPERATIONS.md)。

## Create a project

Requires Node.js 24+ and pnpm 10.20.0 on Windows, macOS or Linux. Copy or clone the template into a new directory, then run initialization before installing dependencies:

```sh
node scripts/init.mjs --name my-project --scope @my-project --backend-port 18080 --frontend-port 2711
pnpm install --frozen-lockfile
pnpm verify
pnpm app:start
```

Initialization has `--dry-run`, input validation and rollback. Repeating it requires `--reconfigure`; reconfiguration changes supported settings without changing project identity or its original scaffoldVersion. Existing `.env` values are preserved except explicitly reconfigured ports. Never initialize this maintainer checkout as a user application. Generated project validation starts as **pending**, not inherited from template results.

Cold start transforms the clone in place; it does not create a second project. The first successful initialization moves the maintainer rules to inactive `.scaffold/SCAFFOLD_MAINTAINER.md`, writes application-specific rules at root `AGENTS.md`, and removes maintainer-only planning and verification artifacts. Later scaffold pulls are source merges, not a supported automatic upgrade path.

There is one base application, no application-type selector. Ant Design, Query, chat, real authentication, SQLite and a diagnostic CLI are not default dependencies or routes. Maintainer integration recipes live in `.scaffold/recipes` and are excluded on initialization; obtain a recipe from the scaffold version you adopted and follow its individual guide. P2 persistence/login/deployment features remain demand-driven.

## Run and diagnose

```sh
pnpm dev
pnpm app:start
pnpm app:status
node scripts/app.mjs status --json
pnpm smoke
pnpm app:logs
node scripts/app.mjs logs --lines 100 --level warn --json
node scripts/app.mjs logs --request-id REQUEST_ID
pnpm app:stop
pnpm app:restart
pnpm doctor
```

`dev` is a foreground development flow. Managed start builds first and records one checkout-owned instance. The build bundles the API into `packages/webui/dist`, emits static WebUI files under `packages/frontend/dist`, and records immutable build identity under root `dist`. Runtime uses Node directly with a repository-owned static server and API proxy; it does not invoke `tsx`, `vite preview`, TypeScript, test tools or formatter packages. API and WebUI bind to loopback. An occupied port is an error; no command kills a port owner. Stop authenticates the recorded supervisor instance instead of trusting a PID alone. A stale launch lock or unresponsive recorded instance requires diagnosis; scripts never guess which foreign process to kill.

A successful build does not prove that a running app is current. Start, status and smoke verify the instance, API contract, build identity, WebUI HTML marker and a referenced JavaScript resource. HTTP requests have a 2s limit including body reads; status/smoke have a 5s probe budget and startup readiness has a 15s budget after build. The build identity includes a source digest, so uncommitted changes are distinguishable. Smoke is not a browser interaction test.

Status/smoke exit codes: 0 fully healthy, 1 unavailable/stopped/identity mismatch, 2 degraded but serving, 3 invalid configuration/state/arguments. For machine-readable output use the Node command directly (pnpm may prepend its own command banner). `doctor` verifies local prerequisites/configuration; it does not certify runtime health.

## Health and logging

- `/health/live`: process responsiveness, no dependency access.
- `/health/ready`: minimal readiness state, independent of business login.
- `/status`: local diagnostic details, version/revision/build time, instanceId, checks, memory storage semantics, uptime and requestId.

Readiness is `starting`, `healthy`, `degraded`, `unhealthy` or `stopping`. Required check failure/timeout means 503; optional failure means degraded/200. No persistent adapter is enabled: schemaVersion/databaseSchema are null, compatibility is not_applicable, and restarting loses memory data. Probes use no-store. Details are intended for loopback; adding non-local exposure requires explicit access control or reducing status details.

Every API response has a server-generated `X-Request-Id`. Error responses preserve `error`, `message`, `timestamp`, `requestId`; internal failures return a safe message. Logs record stable event names and allowlisted HTTP metadata. Bodies, query strings, credentials, personal data and raw tool output are not logged. Internal errors use safe reason codes; arbitrary stack/message serialization is deliberately omitted. Debug-level events do not bypass these rules.

Managed files are UTF-8 NDJSON under `logs/` in the application data directory, with one writer per stream. Default limits: 16KiB/event, 10MiB/file, 7 days, 20 archives, 100MiB total including legacy app.log, 1MiB or 1000 queued events. Size/day rotation, bounded reads, retention and recovery are repository-owned Node code. Disk/permission/queue errors are visible as degraded log health; stderr fallback is rate-limited. Logs may lose buffered events on crash/forced stop and are not a durable audit ledger.

```sh
node scripts/app.mjs logs-clean --dry-run
node scripts/app.mjs logs-clean --apply
```

Cleanup only removes closed owned archives. Build/dependency cleaning preserves logs, local configuration and business data. A legacy `app.log` in the application data directory is reported separately, never mixed into NDJSON or silently erased. See [diagnostic reasons and budgets](docs/OPERATIONS.md).

## Configuration

`.env.example` is the public startup contract. Precedence is process environment > `.env` > defaults; currently no runtime CLI configuration overrides are exposed. `PORT` and `VITE_PORT` must be distinct valid ports; `LOG_LEVEL` is debug/info/warn/error/fatal, default info; `VITE_APP_TITLE` supplies the frontend title. `APP_DATA_DIR` optionally selects one root for settings, backups, state, locks and logs. Relative values resolve from the project root; omission uses the platform application-data directory. No unused database path or session secret is advertised. Compatibility values AUTH_MODE=none/dev do not enable real login; other values fail startup.

`HOST` and `WEB_HOST` default to `127.0.0.1`; an external container owner may explicitly inject `0.0.0.0`. After `pnpm build`, `pnpm app:run` keeps one owner process in the foreground, reports versioned JSON lifecycle events on stdout, forwards SIGINT/SIGTERM, and never daemonizes or restarts itself. The production verification copies only the built output and dependency-free runtime scripts into an empty directory, then proves health, static serving, API proxying and graceful shutdown without `node_modules`. Local background management remains available through `app:start`, `app:stop`, and verified stop-then-start `app:restart`; all mutating actions share a cross-process operation lock and support `--json`. The versioned [service manifest](service.manifest.json) declares scripts, readiness, Open navigation and endpoint roles without machine paths or runtime port mappings. A Dashboard or container adapter remains the lifecycle owner for its deployment mode; do not nest `app:start` inside a container managed by that adapter.

## Extend the application

| Boundary            | Responsibility                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/core`     | Framework-free domain types, application version, and versioned user-settings contracts                            |
| `packages/api`      | Zod / ts-rest request, response, error and health contracts                                                        |
| `packages/db`       | Injected item/settings repositories with memory and atomic file settings adapters; no persistent business database |
| `packages/webui`    | Existing createApp composition factory, real HTTP routes, health engine, bundled server entrypoint                 |
| `packages/frontend` | React pages and centralized ts-rest client                                                                         |
| `scripts`           | Initialization, build, owned lifecycle, log files and verification                                                 |

Change the API contract first, then server/client/tests together. Components use `src/api`, never raw fetch. The Hono app accepts repositories, optional identity resolver and health dependencies through the existing `createApp(options)` composition factory; all business routes share `/api/*`, so extensions require no proxy edits. Startup configuration remains in `.env` and `scripts/lib/config.mjs`. `packages/core/src/settings` owns deterministic versioned import/export for long-lived user settings without filesystem access; every durable document has an application identity, document type and schema version, and applications own payload validation and export redaction. `packages/db` performs previewable import, sequential migration, migration/import backup, validated atomic replacement and backup restoration. Migration failure is surfaced through the injected settings health check; it must never reset user data to defaults. Runtime state remains separate in the lifecycle layer. Optional authentication is an application boundary, not an implicit security feature of the memory CRUD demo.

## Verification and upgrade

```sh
pnpm verify
pnpm verify:generated
pnpm version:set 0.3.1
pnpm verify:push
```

Verify includes Prettier checking, real ESLint/React Hooks/import rules, types, offline deterministic tests, build, a dependency-free production-runtime projection and repository policy. Generated verification does a frozen install, verify, isolated-port managed start/smoke/stop and foreground shutdown. `verify:push` additionally requires a clean Git worktree before and after those checks, so it is run only after the intended release commit is created. CI runs the same functional gates on Windows, Linux and macOS; configured CI is not proof that remote runs passed. Local evidence belongs in PROJECT_STATUS.md. Never apply scaffold changes over an existing application's user data or business code automatically.
