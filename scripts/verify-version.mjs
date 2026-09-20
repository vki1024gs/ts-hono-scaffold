import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) =>
  JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const expected = readJson('package.json').version;
const failures = [];

if (!/^\d+\.\d+\.\d+$/.test(expected || ''))
  failures.push(`Root version is not SemVer: ${expected}`);
for (const entry of readdirSync(path.join(root, 'packages'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const relative = `packages/${entry.name}/package.json`;
  const actual = readJson(relative).version;
  if (actual !== expected)
    failures.push(`${relative}: expected ${expected}, found ${actual}`);
}
const source = readFileSync(
  path.join(root, 'packages/core/src/version.ts'),
  'utf8',
);
const constant = source.match(/APP_VERSION = '([^']+)'/)?.[1];
if (constant !== expected)
  failures.push(
    `packages/core/src/version.ts: expected ${expected}, found ${constant || 'missing'}`,
  );

if (failures.length) {
  console.error(
    `Version alignment failed:\n${failures.map((item) => `- ${item}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`Version alignment verified: ${expected}`);
