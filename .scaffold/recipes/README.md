# Independent integration recipes (0.3.0)

These maintainer-owned files are excluded from initialized projects. Save the desired recipe outside a generated project before initialization, or obtain it from the scaffold version you adopted. There is one base application, no presets and no capability installer. Each recipe owns only its listed files. Use your generated package scope instead of `@proj`. Package installation requires network access; verify and commit the resulting lockfile.

## Ant Design alone

1. Run `pnpm --filter @your-scope/frontend add antd@6.4.3`.
2. Copy `ui/ItemsPage.tsx` to `packages/frontend/src/pages/HomePage.tsx`, adjusting the API package scope. It uses the existing contract client and root page entry; no Query or Zustand dependency is required.
3. Run `pnpm verify`, start the app, and check add/edit/delete confirmation, search, sorting, page navigation, refresh preserving the query string, rapid search changes and failure/retry. Try narrow and keyboard layouts.
4. To remove: restore the base HomePage from your own Git history, run `pnpm --filter @your-scope/frontend remove antd`, verify, and record the change.

## TanStack Query alone

1. Run `pnpm --filter @your-scope/frontend add @tanstack/react-query@5`.
2. Copy `query/ItemsPage.tsx` to `packages/frontend/src/pages/HomePage.tsx`. It uses native controls, no Ant Design. The QueryClient can move to the application root when more pages need it.
3. Defaults: 30s stale time, no focus refetch, one network/5xx read retry, no 4xx retry, no mutation retries; successful writes invalidate `items`. Queries propagate AbortSignal. Run verify; test CRUD, failure recovery, cache reuse and cancellation.
4. To remove: restore the base page, remove the package and verify. UI and Query recipes intentionally target the same example page separately; combining them requires normal application composition, not running both copies side by side.

## Streaming transport and chat

No new runtime dependencies are required. The transport can be reused without the chat page.

1. Copy `stream/contract.ts` to `packages/api/src/chat.ts`; append `export * from './chat';` to that package's index. This declares `text/event-stream` separately from JSON and defines start/token/done/error event schemas.
2. Copy `stream/server.ts` to `packages/webui/src/chat.ts`. In `src/index.ts`, import `registerChat` from `./chat` and call `registerChat(runtime.app, logger)` immediately after createApp. Authentication/authorization must be applied at the app boundary if the local example is exposed to multiple users; it does not claim tenant isolation.
3. Copy `stream/client.ts` to `packages/frontend/src/api/chat.ts` and `stream/ChatPage.tsx` to `packages/frontend/src/pages/ChatPage.tsx`. Add one lazy `/chat` entry to `routes` in App.tsx. Business API paths stay under `/api`; no proxy change is needed. Adjust package scopes in copied files.
4. Copy `stream/stream.test.ts` into frontend/test and `stream/server.test.ts` into webui/test. Run verify. Test consecutive sends, cancellation, unmount, network interruption and EOF without done. Only the streaming endpoint persists the user message; the page does not send a second write. Completed assistant records replace the current temporary reply. Error/cancelled partial messages remain visibly associated with their request.
5. Remove the route entry, registration/imports, copied files/tests and API export to withdraw. No unrelated capability changes are required. Memory conversations reset on restart; no persistence is promised.

## Optional layout and CLI

A sidebar is ordinary frontend composition: render the shared `routes` list in an `<aside>` and toggle its visibility with a labeled button exposing `aria-expanded`; keep a single route/menu list and the skip link. A theme toggle can set a root `data-theme` attribute with CSS variables and a component-local light/dark state. Neither requires a package or changes the API.

An independent diagnostic CLI should call the existing `scripts/app.mjs status --json`, `scripts/doctor.mjs` and `scripts/smoke.mjs`, preserve their exit codes, and avoid a second health engine. It is not included in the base workspace.

Record the adopted recipe version, files, dependency versions, configuration and actual validation results in your project's own status document. These recipes are ordinary source examples, not a plugin framework or automatic migration tool.
