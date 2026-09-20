import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';
import { spawnPnpm } from './lib/pnpm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scope, env } = projectConfig(root);
const mode = process.argv[2] || 'all';
if (!['all', 'api', 'web'].includes(mode)) {
  console.error('Usage: node scripts/dev.mjs [api|web]');
  process.exit(1);
}
const definitions = [];
if (mode === 'all' || mode === 'api')
  definitions.push(['--filter', `${scope}/webui`, 'dev']);
if (mode === 'all' || mode === 'web')
  definitions.push(['--filter', `${scope}/frontend`, 'dev', '--', '--force']);
const children = definitions.map((args) =>
  spawnPnpm(args, { cwd: root, env, stdio: 'inherit', windowsHide: true }),
);
let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill();
};
for (const child of children) {
  child.once('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
