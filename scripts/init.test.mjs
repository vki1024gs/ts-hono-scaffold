import * as io from 'node:fs/promises';
import { atomicWrite } from './init.mjs';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copyTemplate = () => {
  const target = mkdtempSync(path.join(tmpdir(), 'scaffold-init-'));
  cpSync(root, target, {
    recursive: true,
    filter: (source) =>
      !['.git', 'node_modules', '.runtime', '.env'].includes(
        path.basename(source),
      ),
  });
  rmSync(path.join(target, '.scaffold', 'project.json'), { force: true });
  return target;
};
const args = [
  'scripts/init.mjs',
  '--name',
  'fixture-app',
  '--scope',
  '@fixture-app',
  '--backend-port',
  '18181',
  '--frontend-port',
  '12712',
  '--description',
  'Generated fixture application',
  '--allow-occupied-ports',
];

test('dry-run works without installed dependencies and writes nothing', () => {
  const target = copyTemplate();
  try {
    const before = readFileSync(path.join(target, 'package.json'), 'utf8');
    const result = spawnSync(process.execPath, [...args, '--dry-run'], {
      cwd: target,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Dry run complete/);
    assert.equal(
      readFileSync(path.join(target, 'package.json'), 'utf8'),
      before,
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('initialization commits a complete identity and refuses an accidental second run', () => {
  const target = copyTemplate();
  try {
    mkdirSync(path.join(target, 'docs'), { recursive: true });
    for (const file of [
      'PRD-scaffold-evolution.md',
      'PRD-managed-service-contract.md',
    ])
      writeFileSync(path.join(target, 'docs', file), '# completed PRD\n');
    const result = spawnSync(process.execPath, args, {
      cwd: target,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(
      readFileSync(path.join(target, 'package.json'), 'utf8'),
    );
    const marker = JSON.parse(
      readFileSync(path.join(target, '.scaffold/project.json'), 'utf8'),
    );
    assert.equal(manifest.name, '@fixture-app/workspace');
    assert.equal(manifest.description, 'Generated fixture application');
    assert.equal(marker.schemaVersion, 1);
    assert.equal(marker.documentType, 'scaffold-project');
    assert.equal(marker.frontendPort, '12712');
    assert.match(
      readFileSync(path.join(target, '.env'), 'utf8'),
      /VITE_PORT=12712/,
    );
    assert.match(
      readFileSync(path.join(target, 'packages/webui/src/index.ts'), 'utf8'),
      /@fixture-app\/api/,
    );
    const agentRules = readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
    assert.match(agentRules, /^# Application agent rules/);
    assert.match(agentRules, /initialized fixture-app application/);
    assert.match(agentRules, /Package scope: `@fixture-app`/);
    assert.doesNotMatch(agentRules, /scaffold maintainer checkout only/);
    const archivedRules = readFileSync(
      path.join(target, '.scaffold', 'SCAFFOLD_MAINTAINER.md'),
      'utf8',
    );
    assert.match(archivedRules, /^# Scaffold maintainer rules/);
    assert.match(archivedRules, /scaffold maintainer checkout only/);
    assert.match(archivedRules, /must not override the initialized application/);
    for (const file of [
      'PRD-scaffold-evolution.md',
      'PRD-managed-service-contract.md',
    ])
      assert.equal(existsSync(path.join(target, 'docs', file)), false);
    assert.doesNotMatch(
      readFileSync(path.join(target, '.github/workflows/ci.yml'), 'utf8'),
      /112712/,
    );
    const reconfigure = spawnSync(
      process.execPath,
      [
        'scripts/init.mjs',
        '--reconfigure',
        '--name',
        'fixture-app',
        '--scope',
        '@fixture-app',
        '--backend-port',
        '18182',
        '--frontend-port',
        '12713',
        '--description',
        'Reconfigured fixture',
        '--allow-occupied-ports',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    assert.equal(
      reconfigure.status,
      0,
      reconfigure.stdout + reconfigure.stderr,
    );
    const reconfigured = JSON.parse(
      readFileSync(path.join(target, '.scaffold/project.json'), 'utf8'),
    );
    assert.equal(reconfigured.backendPort, '18182');
    assert.equal(reconfigured.frontendPort, '12713');
    assert.ok(reconfigured.reconfiguredAt);
    const second = spawnSync(process.execPath, args, {
      cwd: target,
      encoding: 'utf8',
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already initialized/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('invalid input and dry-run leave the template unchanged', () => {
  const target = copyTemplate();
  try {
    const before = readFileSync(path.join(target, 'package.json'), 'utf8');
    const invalid = spawnSync(
      process.execPath,
      [
        'scripts/init.mjs',
        '--name',
        'bad-port',
        '--scope',
        '@bad-port',
        '--backend-port',
        '19191',
        '--frontend-port',
        '19191',
        '--allow-occupied-ports',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /must be different/);
    assert.equal(
      readFileSync(path.join(target, 'package.json'), 'utf8'),
      before,
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('initialization, reconfiguration, and cleanup preserve external user data', () => {
  const target = copyTemplate();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'scaffold-user-data-'));
  const settingsDir = path.join(dataDir, 'settings');
  const sentinel = path.join(settingsDir, 'user-settings.json');
  const content = '{"schemaVersion":1,"userValue":"preserve-exactly"}\n';
  try {
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(sentinel, content);
    writeFileSync(
      path.join(target, '.env'),
      `APP_DATA_DIR=${dataDir}\nPORT=18080\nVITE_PORT=2711\n`,
    );
    const initialized = spawnSync(process.execPath, args, {
      cwd: target,
      encoding: 'utf8',
    });
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    const reconfigured = spawnSync(
      process.execPath,
      [
        'scripts/init.mjs',
        '--reconfigure',
        '--name',
        'fixture-app',
        '--scope',
        '@fixture-app',
        '--backend-port',
        '18182',
        '--frontend-port',
        '12713',
        '--description',
        'Reconfigured fixture',
        '--allow-occupied-ports',
      ],
      { cwd: target, encoding: 'utf8' },
    );
    assert.equal(
      reconfigured.status,
      0,
      reconfigured.stdout + reconfigured.stderr,
    );
    for (const mode of ['build', 'deps']) {
      const cleaned = spawnSync(
        process.execPath,
        ['scripts/clean.mjs', mode],
        { cwd: target, encoding: 'utf8' },
      );
      assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
    }
    assert.equal(readFileSync(sentinel, 'utf8'), content);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('transaction rolls back already-renamed files after a later commit failure', async () => {
  const target = copyTemplate();
  try {
    const first = path.join(target, 'README.md'),
      second = path.join(target, 'package.json');
    const before = readFileSync(first, 'utf8');
    let renames = 0;
    await assert.rejects(
      atomicWrite(
        new Map([
          [first, 'changed'],
          [second, 'changed'],
        ]),
        {
          ...io,
          rename: async (...args) => {
            if (++renames === 2) throw new Error('injected failure');
            return io.rename(...args);
          },
        },
      ),
    );
    assert.equal(readFileSync(first, 'utf8'), before);
    assert.doesNotThrow(() => JSON.parse(readFileSync(second, 'utf8')));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
