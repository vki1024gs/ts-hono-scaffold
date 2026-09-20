import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: pnpm version:set X.Y.Z');
  process.exit(1);
}
const updateJson = (relative) => {
  const file = path.join(root, relative);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  value.version = version;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
updateJson('package.json');
for (const entry of readdirSync(path.join(root, 'packages'), {
  withFileTypes: true,
})) {
  if (
    entry.isDirectory() &&
    existsSync(path.join(root, 'packages', entry.name, 'package.json'))
  ) {
    updateJson(`packages/${entry.name}/package.json`);
  }
}
writeFileSync(
  path.join(root, 'packages/core/src/version.ts'),
  `export const APP_VERSION = '${version}' as const;\n`,
);
rmSync(projectConfig(root).buildInfoFile, { force: true });
console.log(
  `Set application version to ${version}. Run pnpm verify before committing.`,
);
