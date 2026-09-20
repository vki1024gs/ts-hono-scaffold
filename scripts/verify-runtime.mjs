import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { control } from './lib/diagnostics.mjs';
import { projectConfig } from './lib/config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root),
  stateFile = config.stateFile,
  markerFile = config.buildInfoFile;
const command = (args) =>
  execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
const first = JSON.parse(readFileSync(stateFile, 'utf8'));
const origin = 'http://127.0.0.1:' + first.webPort;
const get = async (relative, options = {}) =>
  fetch(origin + relative, { ...options, signal: AbortSignal.timeout(2000) });
const added = await get('/api/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"name":"runtime-check"}',
});
assert.equal(added.status, 201);
const item = await added.json();
assert.ok(added.headers.get('X-Request-Id'));
assert.equal(
  (
    await get('/api/items/' + item.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"updated"}',
    })
  ).status,
  200,
);
assert.equal(
  (await get('/api/items/' + item.id, { method: 'DELETE' })).status,
  200,
);
const missing = await get('/api/missing');
assert.equal(missing.status, 404);
assert.ok(missing.headers.get('Content-Type').includes('application/json'));
const page = await get('/unknown-page');
assert.equal(page.status, 200);
assert.ok(page.headers.get('Content-Type').includes('text/html'));
const original = readFileSync(markerFile, 'utf8');
try {
  writeFileSync(
    markerFile,
    JSON.stringify({ ...JSON.parse(original), revision: 'wrong-build' }),
  );
  const result = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.ok(
    JSON.parse(result.stdout).checks.some(
      (c) => c.code === 'BUILD_OR_INSTANCE_MISMATCH',
    ),
  );
} finally {
  writeFileSync(markerFile, original);
}
console.log(
  'Runtime CRUD/proxy/page fallback and build-mismatch rejection passed.',
);
const before = await control(first);
assert.ok(before.children.some((c) => c.service === 'api'));
const stopStart = performance.now();
command(['scripts/app.mjs', 'stop']);
assert.ok(performance.now() - stopStart < 7500);
assert.equal(existsSync(stateFile), false);
const status = spawnSync(
  process.execPath,
  ['scripts/app.mjs', 'status', '--json'],
  { cwd: root, encoding: 'utf8', timeout: 10000 },
);
assert.equal(status.status, 1);
assert.equal(JSON.parse(status.stdout).status, 'stopped');
for (const child of before.children) {
  assert.throws(
    () => process.kill(child.pid, 0),
    'Owned child must have exited',
  );
}
command(['scripts/app.mjs', 'start']);
const next = JSON.parse(readFileSync(stateFile, 'utf8'));
assert.notEqual(next.instanceId, first.instanceId);
const current = await control(next);
const api = current.children.find((c) => c.service === 'api');
process.kill(api.pid, 'SIGTERM');
const deadline = Date.now() + 7500;
while (existsSync(stateFile) && Date.now() < deadline)
  await new Promise((r) => setTimeout(r, 50));
assert.equal(
  existsSync(stateFile),
  false,
  'Supervisor must stop the sibling on child exit',
);
for (const child of current.children)
  assert.throws(() => process.kill(child.pid, 0));
console.log(
  'Runtime graceful stop, new-instance restart and child-exit cleanup passed.',
);
