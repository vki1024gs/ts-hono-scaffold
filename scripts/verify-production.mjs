import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './lib/generated.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'scaffold-production-'));
const project = path.join(temporary, 'project');
const [apiPort, webPort] = await freePorts();

function copy(relative) {
  const source = path.join(root, relative);
  if (!existsSync(source))
    throw new Error(`PRODUCTION_ARTIFACT_MISSING: ${relative}`);
  const target = path.join(project, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

for (const relative of [
  'package.json',
  'dist/build-info.json',
  'packages/frontend/dist',
  'packages/webui/dist',
  'scripts/run-app.mjs',
  'scripts/serve-app.mjs',
  'scripts/serve-static.mjs',
  'scripts/lib/config.mjs',
  'scripts/lib/logging.mjs',
])
  copy(relative);

writeFileSync(
  path.join(project, '.env'),
  [
    'HOST=127.0.0.1',
    `PORT=${apiPort}`,
    'WEB_HOST=127.0.0.1',
    `VITE_PORT=${webPort}`,
    'LOG_LEVEL=info',
    'APP_DATA_DIR=.runtime',
    '',
  ].join('\n'),
);
if (existsSync(path.join(project, 'node_modules')))
  throw new Error('PRODUCTION_ARTIFACT_CONTAINS_DEV_DEPENDENCIES');

const child = spawn(process.execPath, ['scripts/run-app.mjs'], {
  cwd: project,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));

const exited = new Promise((resolve) => child.once('exit', resolve));
try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`PRODUCTION_RUNTIME_EXITED_${child.exitCode}: ${stderr}`);
    if (
      stdout.split(/\r?\n/).some((line) => {
        try {
          return JSON.parse(line).type === 'service.ready';
        } catch {
          return false;
        }
      })
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!stdout.includes('"type":"service.ready"'))
    throw new Error(`PRODUCTION_RUNTIME_TIMEOUT: ${stderr}`);
  const [api, web, asset] = await Promise.all([
    fetch(`http://127.0.0.1:${apiPort}/health/ready`),
    fetch(`http://127.0.0.1:${webPort}/`),
    fetch(`http://127.0.0.1:${webPort}/api/items`),
  ]);
  if (!api.ok || !web.ok || !asset.ok)
    throw new Error(
      `PRODUCTION_RUNTIME_UNHEALTHY: api=${api.status} web=${web.status} proxy=${asset.status}`,
    );
  if (!(await web.text()).includes('name="app-build"'))
    throw new Error('PRODUCTION_WEB_BUILD_IDENTITY_MISSING');
  child.kill('SIGTERM');
  const code = await exited;
  if (code !== 0) throw new Error(`PRODUCTION_RUNTIME_STOP_FAILED_${code}`);
  console.log(
    'Production artifact passed without node_modules or development dependencies.',
  );
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
  }
  rmSync(temporary, { recursive: true, force: true });
}
