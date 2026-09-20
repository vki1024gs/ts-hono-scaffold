import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpmSync } from './lib/pnpm.mjs';
import { projectConfig } from './lib/config.mjs';
import { ensureLogDirectory } from './lib/logging.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scope, rootPackage, env, dataDir, buildInfoFile } = projectConfig(root);
await ensureLogDirectory(dataDir);
runPnpmSync(['version:check'], { cwd: root, stdio: 'inherit' });
runPnpmSync(['--filter', scope + '/frontend', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env,
});
runPnpmSync(['--filter', scope + '/webui', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env,
});
const hash = createHash('sha256');
function digest(dir) {
  for (const file of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      ['node_modules', 'dist', 'coverage'].includes(file.name) ||
      file.name.endsWith('.tsbuildinfo')
    )
      continue;
    const full = path.join(dir, file.name);
    if (file.isDirectory()) digest(full);
    else if (file.isFile()) {
      hash.update(path.relative(root, full));
      hash.update(readFileSync(full));
    }
  }
}
digest(path.join(root, 'packages'));
digest(path.join(root, 'scripts'));
hash.update(readFileSync(path.join(root, 'pnpm-lock.yaml')));
let revision = 'source-' + hash.digest('hex').slice(0, 12);
try {
  revision =
    execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() +
    '-' +
    revision;
} catch {}
const marker = {
  schemaVersion: 1,
  version: rootPackage.version,
  revision,
  builtAt: new Date().toISOString(),
  buildId: randomUUID(),
};
const html = path.join(root, 'packages/frontend/dist/index.html');
writeFileSync(
  html,
  readFileSync(html, 'utf8').replace(
    '</head>',
    '<meta name="app-build" content="' + marker.buildId + '" /></head>',
  ),
);
writeFileSync(
  buildInfoFile,
  JSON.stringify(marker, null, 2) + '\n',
);
console.log('Build identity: ' + marker.version + ' @ ' + marker.revision);
