import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withOperationLock } from './lib/operation-lock.mjs';

test('a lifecycle operation excludes a concurrent operation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operation-lock-'));
  const lockFile = path.join(directory, 'operation.lock');
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const first = withOperationLock({
    action: 'start',
    lockFile,
    projectRoot: directory,
    operation: () => blocked,
  });
  while (true) {
    try {
      await readFile(lockFile);
      break;
    } catch {}
  }
  await assert.rejects(
    withOperationLock({
      action: 'restart',
      lockFile,
      projectRoot: directory,
      operation: () => Promise.resolve(),
    }),
    /OPERATION_BUSY/,
  );
  release('finished');
  assert.equal(await first, 'finished');
});

test('a dead same-project owner is recovered without killing a process', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operation-lock-'));
  const lockFile = path.join(directory, 'operation.lock');
  await writeFile(
    lockFile,
    JSON.stringify({
      schemaVersion: 1,
      projectRoot: directory,
      pid: 12345,
      action: 'stop',
    }),
  );
  let aliveChecks = 0;
  const result = await withOperationLock({
    action: 'start',
    lockFile,
    projectRoot: directory,
    alive: () => {
      aliveChecks += 1;
      return false;
    },
    operation: () => Promise.resolve('recovered'),
  });
  assert.equal(result, 'recovered');
  assert.equal(aliveChecks, 1);
});
