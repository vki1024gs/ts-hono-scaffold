import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const remove = (relative) =>
  rmSync(path.join(root, relative), { recursive: true, force: true });

if (mode === 'build') {
  remove('dist');
  remove('coverage');
  for (const name of ['api', 'cli', 'core', 'db', 'frontend', 'webui'])
    remove(`packages/${name}/dist`);
  console.log(
    'Removed rebuildable output. Local configuration and data were preserved.',
  );
} else if (mode === 'deps') {
  remove('node_modules');
  for (const name of ['api', 'cli', 'core', 'db', 'frontend', 'webui'])
    remove(`packages/${name}/node_modules`);
  console.log(
    'Removed dependency directories. Local configuration and data were preserved.',
  );
} else {
  console.error('Usage: node scripts/clean.mjs build|deps');
  process.exit(1);
}
