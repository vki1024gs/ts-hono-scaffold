# Health and log operations (0.3.1)

These are local application diagnostics, not production hosting or audit guarantees. Built WebUI files are served by the repository-owned Node static server, which also proxies API and health paths; development still uses Vite. The first-party event schema is version 1. UTC timestamps support cross-process ordering; durations use a monotonic clock. Ordering between concurrent events is not a transaction guarantee.

## Reasons and actions

| Code/state                   | Meaning                                                     | Action                                                               |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| starting                     | Initialization has not completed                            | Wait within startup budget; inspect startup events                   |
| stopping                     | Readiness revoked                                           | Allow bounded drain; inspect forced-stop events if needed            |
| CHECK_TIMEOUT                | Dependency exceeded 500ms or still has a previous hung call | Inspect dependency; do not repeatedly create hung tasks              |
| CHECK_FAILED                 | Required dependency failed or optional dependency warned    | Inspect registered check and safe application error events           |
| API_UNAVAILABLE_OR_INVALID   | API could not be read/validated within deadline             | Inspect API logs and recorded address                                |
| BUILD_OR_INSTANCE_MISMATCH   | API differs from expected build/managed instance            | Build and restart the managed instance                               |
| WEBUI_BUILD_OR_ASSET_INVALID | Wrong HTML, missing resource or old WebUI build             | Build and restart WebUI; inspect its tool events                     |
| INSTANCE_UNAVAILABLE         | Supervisor cannot prove recorded identity                   | Inspect stale state; never kill the configured port owner            |
| LOG_STATUS_STALE             | Log snapshot unavailable or too old                         | Inspect supervisor and filesystem                                    |
| ENOSPC / LOG_CAPACITY        | Disk full or repository log budget exhausted                | Free space or dry-run/apply archive cleanup; inspect legacy log size |
| EACCES / EPERM               | Directory/file permissions deny writing                     | Restore user access to the configured application data directory     |
| EBUSY                        | File rotation blocked                                       | Release third-party file handle; writer retries then reports failure |
| LOG_QUEUE_FULL / EIO         | Queue overload or slow/failed sink                          | Reduce output rate, inspect disk latency; droppedCount is observable |
| LOG_UNSAFE_PATH              | Symlink/non-regular path would escape file ownership        | Restore a normal directory; do not follow/remove external targets    |
| SHUTDOWN_TIMEOUT             | Drain exceeded budget                                       | Inspect child status; buffered tail may be lost                      |

Individual readiness checks time out at 500ms and share a cached/in-flight round for at most 1s. A timed-out uncancellable dependency keeps its slot until it settles; later rounds report timeout instead of creating more work. Startup and stopping override cached healthy checks. Status includes checkedAt, durationMs and ageMs; it does not mutate business data or run migrations. Machine-local state uses the single `APP_DATA_DIR` root; relative values resolve from the project root and omission uses the platform application-data directory.

Applications that enable durable settings perform compatibility loading before they report ready. Supported older documents are backed up and migrated sequentially; future, malformed, wrong-application, wrong-document, missing-step, or domain-invalid documents fail the required settings check without being replaced by defaults. Settings live under the application data root and backups under its backup directory when composed that way by the application. Import preview is read-only; import commit and restore preserve the previous document before validated atomic replacement. Runtime state and logs are not portable settings and follow their own retention rules.

Ordinary HTTP completions are info; permission failures, slow requests and degradation are warn; 5xx are error; fatal exits stop the service. Exactly one completion event per ordinary request, with a separate safe internal error event if necessary. Stream recipes log completion at actual stream termination, with completed/cancelled/failed independent of the already-sent HTTP 200. No token logging. Successful health probes omit access events; repeated identical failures summarize at most once per 60s and recovery logs once.

## Illustrative payloads (not execution evidence)

Minimal ready responses:

```json
{
  "schemaVersion": 1,
  "status": "healthy",
  "timestamp": "2026-09-08T00:00:00.000Z",
  "requestId": "example-id"
}
```

An optional logging check warning produces degraded/200; a required repository failure produces unhealthy/503. Detailed `/status` additionally supplies identity, memory storage and checks such as:

```json
{
  "name": "repository",
  "required": true,
  "status": "fail",
  "code": "CHECK_TIMEOUT",
  "message": "Check exceeded deadline",
  "checkedAt": "2026-09-08T00:00:00.000Z",
  "durationMs": 500,
  "ageMs": 0
}
```

One complete NDJSON event:

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-09-20T00:00:00.000Z",
  "level": "info",
  "service": "api",
  "component": "api",
  "event": "http.completed",
  "message": "HTTP request completed",
  "pid": 123,
  "instanceId": "example-instance",
  "version": "0.3.1",
  "revision": "example-source",
  "requestId": "example-id",
  "method": "GET",
  "route": "/api/items",
  "statusCode": 200,
  "durationMs": 2,
  "outcome": "completed"
}
```

## File behavior and limits

The supervisor serializes API events and safe WebUI tool summaries into one owned file; role fields preserve origin. Startup build events use a separate attemptId/file. Filenames contain role, UTC creation time and UUID, and closed files have `.archive.ndjson`. No concurrent process appends to the same file. Tool bodies are intentionally omitted because arbitrary tool text cannot be reliably redacted by generic regex.

Whole events rotate before crossing 10MiB or on the next event after a UTC date change. Retention is 7 days/20 archives/100MiB, applied on start, rotation, writes and maintenance; expired files while stopped are handled next time. Active files cannot be silently deleted to satisfy capacity. A stale active file from a crash is retained for diagnosis and counts against capacity; identify its ended instance before manually archiving it. Ordinary cleanup only deletes closed archives.

File write failures keep bounded queues and a 5s recovery cadence. Saturation discards low-severity queued events first, then counts further drops; stderr fallback is at most once a minute per failing writer. A hung filesystem write is marked failed and does not start concurrent writes to the same descriptor; close has a bounded wait. OS-level filesystem calls may remain pending until the process is forcibly terminated. No zero-loss or fsync-per-event guarantee is made.

Log queries scan backwards in chunks, cap scan work at 10MiB and return at most 1000 events. Filters are `--level` (minimum severity), `--service`, `--request-id`, `--instance-id`, `--since` (UTC). `scanTruncated` signals incomplete search; malformed tail records are counted separately. The JSON response is a single object. A legacy app.log is reported by path/size only, for safe inspection outside the NDJSON viewer.

Three-platform file and lifecycle behavior must be verified in CI. File symlink creation can require Windows developer privileges; tests still reject junction directory escapes. Local POSIX permissions are 0700/0600 for created directories/files; on Windows access inherits the user's workspace ACL. A machine used by untrusted OS users needs an appropriate workspace ACL established by its owner.
