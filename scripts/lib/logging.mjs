import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const levels = ['debug', 'info', 'warn', 'error', 'fatal'];
const messages = {
  'app.starting': 'Application starting',
  'app.ready': 'Application ready; memory data is lost on restart',
  'app.startup_failed': 'Application startup failed',
  'app.stopping': 'Application stopping',
  'app.stopped': 'Application stopped',
  'app.forced_stop': 'Shutdown deadline exceeded; buffered logs may be lost',
  'app.child_exited': 'Managed child exited',
  'http.completed': 'HTTP request completed',
  'http.failed': 'Request failed',
  'health.changed': 'Health state changed',
  'health.summary': 'Health failure continues',
  'logging.sink_failed': 'Log sink unavailable',
  'logging.recovered': 'Log sink recovered',
  'logging.dropped': 'Log events were dropped',
  'tool.output': 'Tool output received; raw content omitted',
};
const codes = new Set([
  'INTERNAL_ERROR',
  'CHECK_TIMEOUT',
  'CHECK_FAILED',
  'CONFIG_INVALID',
  'STARTUP_FAILED',
  'SHUTDOWN_TIMEOUT',
  'CHILD_EXITED',
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'NOT_READY',
  'ENOSPC',
  'EACCES',
  'EPERM',
  'EBUSY',
  'EIO',
  'EPIPE',
  'LOG_CAPACITY',
  'LOG_UNSAFE_PATH',
  'LOG_QUEUE_FULL',
]);
const safeId = (v) =>
  typeof v === 'string' && /^[a-zA-Z0-9._:@-]{1,100}$/.test(v) ? v : 'unknown';
export function eventRecord(identity, level, event, fields = {}) {
  const record = {
    schemaVersion: 1,
    timestamp:
      typeof identity.timestamp === 'string' &&
      /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(identity.timestamp) &&
      Number.isFinite(Date.parse(identity.timestamp))
        ? identity.timestamp
        : new Date().toISOString(),
    level: levels.includes(level) ? level : 'error',
    service: safeId(identity.service),
    component: safeId(identity.component || identity.service),
    event: Object.hasOwn(messages, event) ? event : 'http.failed',
    message: messages[event] || 'Internal event',
    pid:
      Number.isInteger(identity.pid) && identity.pid > 0
        ? identity.pid
        : process.pid,
    instanceId: safeId(identity.instanceId),
    version: safeId(identity.version),
    revision: safeId(identity.revision),
  };
  if (identity.attemptId) record.attemptId = safeId(identity.attemptId);
  for (const name of ['requestId', 'attemptId'])
    if (fields[name]) record[name] = safeId(fields[name]);
  if (
    ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(
      fields.method,
    )
  )
    record.method = fields.method;
  // Only route templates registered in code reach this boundary. Never raw URLs.
  if (
    typeof fields.route === 'string' &&
    /^\/(?:api|health)(?:\/[a-z-]+|\/:[a-zA-Z]+)*$|^\/status$|^unmatched$/.test(
      fields.route,
    )
  )
    record.route = fields.route;
  for (const name of [
    'statusCode',
    'durationMs',
    'exitCode',
    'droppedCount',
    'suppressedCount',
    'childPid',
  ])
    if (Number.isFinite(fields[name])) record[name] = Math.max(0, fields[name]);
  for (const name of ['outcome', 'previous', 'status'])
    if (
      [
        'completed',
        'cancelled',
        'failed',
        'healthy',
        'degraded',
        'unhealthy',
        'starting',
        'stopping',
      ].includes(fields[name])
    )
      record[name] = fields[name];
  if (['SIGTERM', 'SIGINT', 'SIGKILL'].includes(fields.signal))
    record.signal = fields.signal;
  if (['api', 'webui'].includes(fields.childService))
    record.childService = fields.childService;
  if (
    typeof fields.checkName === 'string' &&
    /^[a-z][a-z_.-]{0,63}$/.test(fields.checkName)
  )
    record.checkName = fields.checkName;
  if (['stdout', 'stderr'].includes(fields.stream))
    record.stream = fields.stream;
  if (fields.error || fields.code) {
    const code = fields.code || fields.error?.code;
    record.error = {
      code: codes.has(code) ? code : 'INTERNAL_ERROR',
      type: 'Error',
      message: 'See the reason code and diagnostic guide',
    };
  }
  return record;
}
export function encodeEvent(record) {
  let line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > 16384)
    line =
      JSON.stringify({
        ...eventRecord(record, 'warn', 'http.failed'),
        truncated: true,
      }) + '\n';
  return line;
}
let stdoutPending = 0;
function boundedStdout(line) {
  if (stdoutPending >= 1000 || process.stdout.writableLength + Buffer.byteLength(line) > 1024 * 1024)
    throw Object.assign(new Error('Output queue full'), {code:'LOG_QUEUE_FULL'});
  stdoutPending++;
  try {return process.stdout.write(line, () => {stdoutPending--;});}
  catch (error) {stdoutPending--;throw error;}
}
export function createLogger(
  identity,
  {
    level = 'info',
    write = boundedStdout,
    fallback = () => process.stderr.write('LOG_SINK_UNAVAILABLE\n'),
  } = {},
) {
  if (!levels.includes(level)) throw new Error('CONFIG_LOG_LEVEL');
  let failed = false, droppedCount = 0,
    lastFallback = -Infinity;
  const log = (severity, event, fields) => {
    if (levels.indexOf(severity) < levels.indexOf(level)) return;
    try {
      write(encodeEvent(eventRecord(identity, severity, event, fields)));
      if (failed) write(encodeEvent(eventRecord(identity, 'warn', 'logging.recovered', {droppedCount})));
      failed = false;
    } catch {
      droppedCount++;failed = true;
      if (Date.now() - lastFallback >= 60000) {
        lastFallback = Date.now();
        try {
          fallback();
        } catch {
          /* Last-resort output can also fail. */
        }
      }
    }
  };
  return { log, status: () => ({ ok: !failed, droppedCount }) };
}
export async function ensureDataDirectory(dataDir, create = true) {
  const directory = path.resolve(dataDir);
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let info;
  try { info = await fs.lstat(directory); }
  catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Object.assign(new Error('Unsafe application data path'), {
      code: 'LOG_UNSAFE_PATH',
    });
  return directory;
}
export async function ensureLogDirectory(dataDir, create = true) {
  const root = await ensureDataDirectory(dataDir, create);
  if (!root) return null;
  const directory = path.join(root, 'logs');
  if (create) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  let info;
  try { info = await fs.lstat(directory); }
  catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Object.assign(new Error('Unsafe log path'), { code: 'LOG_UNSAFE_PATH' });
  return directory;
}
const ownedName =
  /^(?:api|webui|supervisor|build)-[a-zA-Z0-9-]+(?:\.archive)?\.ndjson$/;
export async function logFiles(dataDir) {
  const directory = await ensureLogDirectory(dataDir, false);
  const files = [];
  if (!directory) return files;
  for (const name of await fs.readdir(directory)) {
    if (!ownedName.test(name)) continue;
    const file = path.join(directory, name),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Object.assign(new Error('Unsafe log file'), {
        code: 'LOG_UNSAFE_PATH',
      });
    files.push({
      file,
      name,
      size: stat.size,
      mtime: stat.mtimeMs,
      archive: name.endsWith('.archive.ndjson'),
    });
  }
  return files.sort(
    (a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name),
  );
}
export class LogSink {
  constructor(dataDir, identity, options = {}) {
    this.dataDir = dataDir;
    this.identity = identity;
    this.options = {
      level: 'debug',
      maxFile: 10 * 1024 * 1024,
      maxTotal: 100 * 1024 * 1024,
      maxArchives: 20,
      maxAge: 7 * 86400000,
      maxQueueBytes: 1024 * 1024,
      maxQueue: 1000,
      now: Date.now,
      fallback: () => process.stderr.write('LOG_SINK_UNAVAILABLE\n'),
      ...options,
    };
    this.queue = [];
    this.bytes = 0;
    this.dropped = 0;
    this.error = null;
    this.lastFallback = -Infinity;
    this.lastCleanup = 0;
    this.reportedDropped = 0;
    this.busy = null;
    this.closed = false;
  }
  async open() {
    this.directory = await ensureLogDirectory(this.dataDir);
    await this.prune();
    await this.newFile();
    this.timer = setInterval(() => {
      if (!this.closed) {
        this.enqueue(
          eventRecord(this.identity, 'debug', 'logging.dropped', {
            droppedCount: this.dropped,
          }),
          true,
        );
      }
    }, 5000);
    this.timer.unref();
    return this;
  }
  async newFile() {
    this.file = path.join(
      this.directory,
      safeId(this.identity.service) +
        '-' +
        new Date(this.options.now()).toISOString().replace(/[^0-9TZ]/g, '') +
        '-' +
        randomUUID() +
        '.ndjson',
    );
    this.handle = await fs.open(this.file, 'wx', 0o600);
    this.size = 0;
    this.date = new Date(this.options.now()).toISOString().slice(0, 10);
  }
  snapshot() {
    return {
      schemaVersion: 1,
      instanceId: this.identity.instanceId,
      updatedAt: new Date().toISOString(),
      ok: !this.error,
      droppedCount: this.dropped,
      code: this.error || 'PASS',
    };
  }
  enqueue(record, maintenance = false) {
    if (
      this.closed ||
      (!maintenance &&
        levels.indexOf(record.level) < levels.indexOf(this.options.level))
    )
      return;
    const line = encodeEvent(record),
      size = Buffer.byteLength(line);
    const full = () =>
      this.bytes + size > this.options.maxQueueBytes ||
      this.queue.length >= this.options.maxQueue;
    if (full() && levels.indexOf(record.level) >= 2) {
      while (full()) {
        const i = this.queue.findIndex((x) => levels.indexOf(x.level) < 2);
        if (i < 0) break;
        this.bytes -= this.queue[i].size;
        this.queue.splice(i, 1);
        this.dropped++;
      }
    }
    if (full()) {
      this.dropped++;
      this.fail('LOG_QUEUE_FULL');
      return;
    }
    this.queue.push({ line, size, level: record.level, maintenance });
    this.bytes += size;
    if (!this.busy)
      this.busy = this.drain().finally(() => {
        this.busy = null;
      });
  }
  fail(code) {
    this.error = codes.has(code) ? code : 'EIO';
    if (this.options.now() - this.lastFallback >= 60000) {
      this.lastFallback = this.options.now();
      try {
        this.options.fallback();
      } catch {
        /* bounded fallback */
      }
    }
  }
  async prune(incoming = 0) {
    const files = await logFiles(this.dataDir);
    let legacyBytes = 0;
    try {
      const stat = await fs.lstat(path.join(this.dataDir, 'app.log'));
      if (stat.isSymbolicLink() || !stat.isFile())
        throw Object.assign(new Error('Unsafe legacy log'), {
          code: 'LOG_UNSAFE_PATH',
        });
      legacyBytes = stat.size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let total = legacyBytes + files.reduce((n, f) => n + f.size, 0),
      count = files.filter((f) => f.archive).length;
    for (const file of files.filter((f) => f.archive)) {
      if (
        this.options.now() - file.mtime > this.options.maxAge ||
        count > this.options.maxArchives ||
        total + incoming > this.options.maxTotal
      ) {
        await fs.unlink(file.file);
        total -= file.size;
        count--;
      }
    }
    if (total + incoming > this.options.maxTotal)
      throw Object.assign(new Error('Log capacity exceeded'), {
        code: 'LOG_CAPACITY',
      });
    this.lastCleanup = this.options.now();
  }
  async rotate() {
    this.pendingRotation = true;
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        await (this.options.rename || fs.rename)(
          this.file,
          this.file.replace('.ndjson', '.archive.ndjson'),
        );
        last = null;
        break;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 20 * (i + 1)));
      }
    }
    if (last) throw last;
    this.pendingRotation = false;
    await this.newFile();
  }
  async writeLine(line, size) {
    if (this.pendingRotation) await this.rotate();
    else if (!this.handle) await this.newFile();
    if (
      this.size &&
      (this.size + size > this.options.maxFile ||
        this.date !== new Date(this.options.now()).toISOString().slice(0, 10))
    )
      await this.rotate();
    if (size > this.options.maxFile)
      throw Object.assign(new Error('Event exceeds file budget'), {
        code: 'LOG_CAPACITY',
      });
    await this.prune(size);
    // A sole writer serializes each complete event. Tests inject a slow/failing writer.
    const timer = setTimeout(() => this.fail('EIO'), 500);
    try {
      if (this.options.write) await this.options.write(this.handle, line);
      else await this.handle.writeFile(line);
    } finally {
      clearTimeout(timer);
    }
    this.size += size;
  }
  async drain() {
    while (this.queue.length) {
      const item = this.queue.shift();
      this.bytes -= item.size;
      if (this.error && this.options.now() - (this.lastAttempt || 0) < 5000) {
        if (!item.maintenance) this.dropped++;
        continue;
      }
      this.lastAttempt = this.options.now();
      try {
        if (!item.maintenance) await this.writeLine(item.line, item.size);
        else if (this.options.now() - this.lastCleanup >= 60000 || this.error)
          await this.prune();
        if (this.error || this.dropped > this.reportedDropped) {
          const line = encodeEvent(
            eventRecord(
              this.identity,
              'warn',
              this.error ? 'logging.recovered' : 'logging.dropped',
              { droppedCount: this.dropped },
            ),
          );
          await this.writeLine(line, Buffer.byteLength(line));
          this.reportedDropped = this.dropped;
        }
        this.error = null;
      } catch (error) {
        this.dropped += item.maintenance ? 0 : 1;
        this.fail(error.code);
      }
    }
  }
  async flush(timeoutMs = 1000) {
    let timer;
    const complete = await Promise.race([
      (this.busy || Promise.resolve()).then(() => true),
      new Promise((r) => {
        timer = setTimeout(() => r(false), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return complete;
  }
  async close(timeoutMs = 1000) {
    this.closed = true;
    clearInterval(this.timer);
    const done = await this.flush(timeoutMs);
    if (done && this.handle) {
      await this.handle.close();
      this.handle = null;
      await fs
        .rename(this.file, this.file.replace('.ndjson', '.archive.ndjson'))
        .catch((e) => this.fail(e.code));
      await this.prune().catch((e) => this.fail(e.code));
    }
    return done;
  }
}
export async function readLogs(
  dataDir,
  {
    lines = 80,
    level = 'debug',
    service,
    requestId,
    instanceId,
    since,
    maxScan = 10 * 1024 * 1024,
  } = {},
) {
  if (
    !Number.isInteger(lines) ||
    lines < 1 ||
    lines > 1000 ||
    !levels.includes(level) ||
    (since &&
      (!/^\d{4}-.*Z$/.test(since) || !Number.isFinite(Date.parse(since))))
  )
    throw new Error('Invalid log query');
  const files = (await logFiles(dataDir)).reverse();
  const events = [];
  let scanned = 0,
    malformed = 0,
    scanTruncated = false;
  for (const file of files) {
    if (scanned >= maxScan) {
      scanTruncated = true;
      break;
    }
    const handle = await fs.open(file.file, 'r');
    let position = file.size,
      carry = Buffer.alloc(0);
    try {
      while (position > 0 && scanned < maxScan) {
        const length = Math.min(64 * 1024, position, maxScan - scanned);
        position -= length;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        scanned += bytesRead;
        const combined = Buffer.concat([buffer.subarray(0, bytesRead), carry]);
        const boundary = combined.indexOf(10);
        const rows =
          boundary < 0
            ? []
            : combined
                .subarray(boundary + 1)
                .toString('utf8')
                .split('\n');
        carry = boundary < 0 ? combined : combined.subarray(0, boundary);
        if (position === 0) {
          rows.unshift(carry.toString('utf8'));
          carry = Buffer.alloc(0);
        }
        for (const row of rows.reverse()) {
          if (!row.trim()) continue;
          let value;
          try {
            value = JSON.parse(row);
          } catch {
            malformed++;
            continue;
          }
          if (value.schemaVersion !== 1 || !levels.includes(value.level)) {
            malformed++;
            continue;
          }
          if (
            levels.indexOf(value.level) < levels.indexOf(level) ||
            (service && value.service !== service) ||
            (requestId && value.requestId !== requestId) ||
            (instanceId && value.instanceId !== instanceId) ||
            (since && value.timestamp < since)
          )
            continue;
          // Sanitize again; historical/tampered logs are untrusted input.
          if (
            typeof value.timestamp !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value.timestamp) ||
            !Number.isFinite(Date.parse(value.timestamp))
          ) {
            malformed++;
            continue;
          }
          events.push({
            ...eventRecord(value, value.level, value.event, value),
            timestamp: value.timestamp,
          });
        }
        if (carry.length > 16384) {
          malformed++;
          carry = Buffer.alloc(0);
        }
      }
      if (position > 0) scanTruncated = true;
    } finally {
      await handle.close();
    }
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    schemaVersion: 1,
    events: events.slice(-lines),
    scanTruncated,
    malformed,
    scannedBytes: scanned,
  };
}
export async function cleanLogs(dataDir, dryRun = true) {
  const files = (await logFiles(dataDir)).filter((f) => f.archive);
  if (!dryRun) for (const f of files) await fs.unlink(f.file);
  return {
    schemaVersion: 1,
    dryRun,
    files: files.map((f) => ({
      path: path.relative(dataDir, f.file),
      bytes: f.size,
    })),
    count: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
  };
}
