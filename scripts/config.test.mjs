import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  defaultAppDataDir,
  projectConfig,
  resolveAppDataDir,
} from './lib/config.mjs';

test('application data defaults follow each operating system', () => {
  assert.equal(
    defaultAppDataDir('@sample/workspace', {}, 'darwin', '/home/test'),
    path.join('/home/test', 'Library', 'Application Support', 'sample'),
  );
  assert.equal(
    defaultAppDataDir('@sample/workspace', { APPDATA: 'C:\\Data' }, 'win32', 'C:\\Users\\test'),
    path.join('C:\\Data', 'sample'),
  );
  assert.equal(
    defaultAppDataDir('@sample/workspace', { XDG_DATA_HOME: '/data' }, 'linux', '/home/test'),
    path.join('/data', 'sample'),
  );
});

test('APP_DATA_DIR supports project-relative paths', () => {
  assert.equal(
    resolveAppDataDir('/workspace/app', '@sample/workspace', { APP_DATA_DIR: '.local-data' }),
    path.resolve('/workspace/app/.local-data'),
  );
});

test('process environment overrides .env for the application data directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scaffold-config-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"@sample/workspace"}\n');
  writeFileSync(path.join(root, '.env'), 'APP_DATA_DIR=.from-env-file\nPORT=18080\nVITE_PORT=2711\n');
  const config = projectConfig(root, {
    APP_DATA_DIR: '.from-process',
    PORT: '18081',
    VITE_PORT: '2712',
  });
  assert.equal(config.dataDir, path.join(root, '.from-process'));
  assert.equal(config.env.APP_DATA_DIR, config.dataDir);
  assert.equal(config.settingsDir, path.join(config.dataDir, 'settings'));
  assert.equal(config.backupDir, path.join(config.dataDir, 'backup'));
  assert.equal(config.apiPort, 18081);
});

test('listen hosts default to loopback and accept explicit container bindings', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scaffold-hosts-'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"@sample/workspace"}\n');
  const local = projectConfig(root, { PORT: '18080', VITE_PORT: '2711' });
  assert.equal(local.apiHost, '127.0.0.1');
  assert.equal(local.webHost, '127.0.0.1');
  const container = projectConfig(root, {
    HOST: '0.0.0.0',
    WEB_HOST: '0.0.0.0',
    PORT: '18080',
    VITE_PORT: '2711',
  });
  assert.equal(container.apiHost, '0.0.0.0');
  assert.equal(container.apiOrigin, 'http://127.0.0.1:18080');
  assert.throws(() =>
    projectConfig(root, {
      HOST: 'all-interfaces',
      PORT: '18080',
      VITE_PORT: '2711',
    }),
  );
});
