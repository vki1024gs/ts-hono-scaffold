import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  symlink,
  readdir,
  appendFile,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LogSink,
  createLogger,
  eventRecord,
  encodeEvent,
  readLogs,
  cleanLogs,
  logFiles,
  ensureLogDirectory,
} from './lib/logging.mjs';
const identity = {
  service: 'api',
  instanceId: 'fixture',
  version: '0.3.1',
  revision: 'fixture',
};
async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'scaffold-logs-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const event = (level = 'info') =>
  eventRecord(identity, level, 'http.completed', {
    requestId: 'request-one',
    method: 'GET',
    route: '/api/items',
    statusCode: 200,
    durationMs: 2,
  });
test('event whitelist excludes nested credentials, body, raw URL and hostile error text', () => {
  const record = eventRecord(identity, 'error', 'http.failed', {
    error: {
      message: 'secret-canary',
      stack: 'secret-canary',
      cause: { password: 'secret-canary' },
    },
    body: 'secret-canary',
    authorization: 'secret-canary',
    route: '/api/items?token=secret-canary',
    message: 'secret-canary\r\n{"level":"fatal"}',
  });
  const line = encodeEvent(record);
  assert.ok(!line.includes('secret-canary'));
  assert.equal(line.split('\n').length, 2);
  assert.ok(Buffer.byteLength(line) <= 16384);
  const huge = encodeEvent({ ...record, message: 'x'.repeat(50000) });
  assert.equal(JSON.parse(huge).truncated, true);
});
test('LOG_LEVEL filters ordinary events and handles failing output without recursion', () => {
  const lines = [];
  const logger = createLogger(identity, {
    level: 'warn',
    write: (line) => lines.push(line),
  });
  logger.log('info', 'app.ready');
  logger.log('error', 'http.failed');
  assert.equal(lines.length, 1);
  let fallback = 0;
  const failed = createLogger(identity, {
    write: () => {
      throw Error();
    },
    fallback: () => fallback++,
  });
  failed.log('fatal', 'http.failed');
  failed.log('fatal', 'http.failed');
  assert.equal(fallback, 1);
  assert.equal(failed.status().ok, false);
  assert.throws(() => createLogger(identity, { level: 'invalid' }));
});
test('size/day rotation preserves complete JSON and bounded retention across restart', () =>
  fixture(async (root) => {
    let now = Date.now();
    const sink = await new LogSink(root, identity, {
      maxFile: 1000,
      maxTotal: 4000,
      maxArchives: 2,
      now: () => now,
    }).open();
    for (let i = 0; i < 12; i++) {
      sink.enqueue(event());
      await sink.flush();
    }
    now += 86400000;
    sink.enqueue(event());
    await sink.close();
    let files = await logFiles(root);
    assert.ok(files.filter((f) => f.archive).length <= 3);
    for (const file of files) {
      assert.ok(file.size <= 1000);
      for (const line of (await readFile(file.file, 'utf8')).trim().split('\n'))
        if (line) JSON.parse(line);
    }
    const second = await new LogSink(root, identity, {
      maxFile: 1000,
      maxTotal: 4000,
      maxArchives: 2,
    }).open();
    await second.close();
    files = await logFiles(root);
    assert.ok(files.reduce((n, f) => n + f.size, 0) <= 4000);
  }));
test('ENOSPC/EACCES are visible, dropped events counted and sink recovers', () =>
  fixture(async (root) => {
    for (const code of ['ENOSPC', 'EACCES']) {
      let now = 10000,
        broken = true,
        fallback = 0;
      const sink = await new LogSink(root, identity, {
        now: () => now,
        write: async (handle, line) => {
          if (broken) throw Object.assign(Error(), { code });
          await handle.writeFile(line);
        },
        fallback: () => fallback++,
      }).open();
      sink.enqueue(event());
      await sink.flush();
      assert.equal(sink.snapshot().ok, false);
      assert.equal(sink.snapshot().code, code);
      assert.equal(fallback, 1);
      broken = false;
      now += 5000;
      sink.enqueue(event());
      await sink.flush();
      assert.equal(sink.snapshot().ok, true);
      await sink.close();
    }
    const read = await readLogs(root);
    assert.ok(read.events.some((e) => e.event === 'logging.recovered'));
    assert.ok(read.events.some((e) => e.droppedCount >= 1));
  }));
test('slow sink has bounded queues, prioritizes errors and respects flush deadline', () =>
  fixture(async (root) => {
    let resolve;
    const blocked = new Promise((r) => (resolve = r));
    const sink = await new LogSink(root, identity, {
      maxQueue: 2,
      maxQueueBytes: 2000,
      write: async (handle, line) => {
        await blocked;
        await handle.writeFile(line);
      },
      fallback: () => {},
    }).open();
    for (let i = 0; i < 20; i++) sink.enqueue(event());
    sink.enqueue(event('error'));
    assert.ok(sink.queue.length <= 2);
    assert.ok(sink.bytes <= 2000);
    assert.ok(sink.dropped > 0);
    assert.equal(await sink.flush(10), false);
    resolve();
    await sink.close();
  }));
test('bounded query filters across files and reports malformed/truncated data', () =>
  fixture(async (root) => {
    const sink = await new LogSink(root, identity).open();
    sink.enqueue(event());
    sink.enqueue(event('error'));
    await sink.close();
    const files = await logFiles(root);
    await appendFile(files[0].file, '{"incomplete":');
    const result = await readLogs(root, {
      level: 'error',
      requestId: 'request-one',
    });
    assert.equal(result.events.length, 1);
    assert.equal(result.malformed, 1);
    const short = await readLogs(root, { maxScan: 40 });
    assert.equal(short.scanTruncated, true);
    assert.ok(short.scannedBytes <= 40);
    await assert.rejects(readLogs(root, { lines: 1001 }));
  }));
test('log cleanup dry-run preserves active files and foreign files', () =>
  fixture(async (root) => {
    const sink = await new LogSink(root, identity).open();
    sink.enqueue(event());
    await sink.flush();
    await writeFile(path.join(root, 'logs', 'user-data.txt'), 'keep');
    assert.equal((await cleanLogs(root)).count, 0);
    assert.ok(
      (await readdir(path.join(root, 'logs'))).includes(
        path.basename(sink.file),
      ),
    );
    await sink.close();
    const plan = await cleanLogs(root);
    assert.equal(plan.count, 1);
    assert.equal((await logFiles(root)).length, 1);
    await cleanLogs(root, false);
    assert.equal((await logFiles(root)).length, 0);
    assert.equal(
      await readFile(path.join(root, 'logs/user-data.txt'), 'utf8'),
      'keep',
    );
  }));
test('unsafe symlink directories and owned files are rejected without touching targets', () =>
  fixture(async (root) => {
    const outside = await mkdtemp(path.join(tmpdir(), 'scaffold-outside-'));
    const dataDir = path.join(root, 'data');
    try {
      await symlink(
        outside,
        dataDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await assert.rejects(ensureLogDirectory(dataDir));
      await rm(dataDir);
      const dir = await ensureLogDirectory(dataDir);
      await writeFile(path.join(outside, 'protected'), 'keep');
      try {
        await symlink(
          path.join(outside, 'protected'),
          path.join(dir, 'api-fixture.archive.ndjson'),
        );
      } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') return;
        throw error;
      }
      await assert.rejects(cleanLogs(dataDir, false));
      assert.equal(
        await readFile(path.join(outside, 'protected'), 'utf8'),
        'keep',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));
test('expired archives are removed even below capacity', () =>
  fixture(async (root) => {
    const sink = await new LogSink(root, identity).open();
    sink.enqueue(event());
    await sink.close();
    const file = (await logFiles(root))[0];
    await utimes(file.file, 0, 0);
    const second = await new LogSink(root, identity).open();
    assert.equal((await logFiles(root)).filter((f) => f.archive).length, 0);
    await second.close();
  }));
test('query preserves the originating PID instead of attributing history to the viewer', () =>
  fixture(async (root) => {
    const sink = await new LogSink(root, identity).open();
    sink.enqueue(eventRecord({ ...identity, pid: 9876 }, 'info', 'app.ready'));
    await sink.close();
    assert.equal((await readLogs(root)).events[0].pid, 9876);
  }));
test('capacity includes legacy files and refuses expansion when no archive can be removed', () =>
  fixture(async (root) => {
    await ensureLogDirectory(root);
    await writeFile(path.join(root, 'app.log'), 'x'.repeat(1024));
    await assert.rejects(
      new LogSink(root, identity, { maxTotal: 512 }).open(),
      { code: 'LOG_CAPACITY' },
    );
  }));
test('rotation EBUSY retries are bounded and recovery retains the old complete file', () =>
  fixture(async (root) => {
    const io = await import('node:fs/promises');
    let busy = true,
      attempts = 0,
      now = Date.now();
    const sink = await new LogSink(root, identity, {
      maxFile: 600,
      now: () => now,
      rename: async (...args) => {
        attempts++;
        if (busy) throw Object.assign(Error(), { code: 'EBUSY' });
        return io.rename(...args);
      },
      fallback: () => {},
    }).open();
    sink.enqueue(event());
    await sink.flush();
    sink.enqueue(event());
    await sink.flush();
    assert.equal(sink.snapshot().code, 'EBUSY');
    assert.equal(attempts, 3);
    busy = false;
    now += 5000;
    sink.enqueue(event());
    await sink.flush();
    assert.equal(sink.snapshot().ok, true);
    await sink.close();
    for (const file of await logFiles(root))
      for (const line of (await readFile(file.file, 'utf8')).trim().split('\n'))
        if (line) JSON.parse(line);
  }));
test('reading and dry-run on a never-started checkout create no runtime directories', () =>
  fixture(async (root) => {
    assert.equal((await cleanLogs(root, true)).count, 0);
    assert.equal((await readLogs(root)).events.length, 0);
    assert.deepEqual(await readdir(root), []);
  }));
