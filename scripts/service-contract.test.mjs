import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';
import { validateServiceManifest } from './lib/service-manifest.mjs';
import { serviceCommands } from './serve-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a synthetic Dashboard can resolve the generated service contract', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'service.manifest.json'), 'utf8'),
  );
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(validateServiceManifest(manifest, pkg), []);
  assert.equal(manifest.schemaVersion, 1);
  for (const script of [
    manifest.runtime.foregroundScript,
    ...Object.values(manifest.runtime.managedScripts),
  ])
    assert.equal(typeof pkg.scripts[script], 'string');
  assert.deepEqual(
    manifest.endpoints.map((endpoint) => endpoint.label),
    ['WebUI', 'API'],
  );
  assert.equal(manifest.open.endpointId, 'webui');
  assert.equal(manifest.health.endpointId, 'api');
  assert.equal(pkg.scripts['app:update'], undefined);
});

test('status and logs expose the shared machine-readable envelope', () => {
  const environment = {
    ...process.env,
    APP_DATA_DIR: path.join(root, '.runtime-contract-test-does-not-exist'),
  };
  for (const action of ['status', 'logs']) {
    const result = spawnSync(
      process.execPath,
      ['scripts/app.mjs', action, '--json'],
      { cwd: root, env: environment, encoding: 'utf8' },
    );
    const output = JSON.parse(result.stdout);
    assert.equal(output.schemaVersion, 1);
    assert.equal(output.action, action);
    assert.equal(output.outcome, 'succeeded');
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test('the service contract rejects unknown fields', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'service.manifest.json'), 'utf8'),
  );
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  manifest.runtime.surprise = true;
  assert.ok(
    validateServiceManifest(manifest, pkg).includes(
      'manifest.runtime: unknown field surprise',
    ),
  );
});

test('container-style host and port injection reaches child commands', () => {
  const environment = {
    HOST: '0.0.0.0',
    WEB_HOST: '0.0.0.0',
    PORT: '31080',
    VITE_PORT: '31711',
  };
  const config = projectConfig(root, environment);
  assert.equal(config.apiHost, '0.0.0.0');
  assert.equal(config.webHost, '0.0.0.0');
  assert.equal(config.apiOrigin, 'http://127.0.0.1:31080');
  const commands = serviceCommands(root, environment);
  assert.equal(commands[0].env.HOST, '0.0.0.0');
  assert.ok(commands[1].args.includes('0.0.0.0'));
});
