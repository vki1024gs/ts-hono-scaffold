import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { serviceCommands } from './serve-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('doctor executes with the repository pnpm version', () => {
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pnpm 10\.20\.0 \(required: 10\.20\.0\)/);
});

test('managed services launch through Node without shell command strings', () => {
  const commands = serviceCommands(root);
  assert.deepEqual(
    commands.map(({ command }) => command),
    [process.execPath, process.execPath],
  );
  assert.equal(commands[0].args[0], '--import');
  assert.ok(commands[1].args[0].endsWith('vite.js'));
});

test('safe build cleaning preserves local configuration and data', () => {
  const source = spawnSync(process.execPath, ['scripts/clean.mjs', 'build'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(source.status, 0, source.stdout + source.stderr);
  assert.match(source.stdout, /configuration and data were preserved/);
});
