import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpmSync } from './lib/pnpm.mjs';
import { isValidPort, projectConfig } from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
let failures = 0;
const report = (kind, message, next = '') => {
  console.log(`[${kind}] ${message}${next ? `\n       Next: ${next}` : ''}`);
  if (kind === 'FAIL') failures += 1;
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
report(
  nodeMajor >= 24 ? 'PASS' : 'FAIL',
  `Node ${process.versions.node} (required: >=24)`,
  'Install Node.js 24 or newer.',
);
try {
  const actual = runPnpmSync(['--version'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  report(
    actual === '10.20.0' ? 'PASS' : 'FAIL',
    `pnpm ${actual} (required: 10.20.0)`,
    'Run corepack enable, then corepack prepare pnpm@10.20.0 --activate.',
  );
} catch {
  report(
    'FAIL',
    'pnpm is unavailable.',
    'Run corepack enable, then corepack prepare pnpm@10.20.0 --activate.',
  );
}

for (const relative of [
  'package.json',
  'pnpm-lock.yaml',
  '.env.example',
  'README.md',
  'AGENTS.md',
]) {
  report(
    existsSync(path.join(root, relative)) ? 'PASS' : 'FAIL',
    `${relative} ${existsSync(path.join(root, relative)) ? 'is present' : 'is missing'}.`,
  );
}
report(
  existsSync(path.join(root, '.env')) ? 'PASS' : 'WARN',
  `.env ${existsSync(path.join(root, '.env')) ? 'is present' : 'is absent'}.`,
  'Copy .env.example to .env before a managed deployment.',
);
report(
  path.isAbsolute(config.dataDir) ? 'PASS' : 'FAIL',
  'Application data directory resolved successfully.',
  'Set APP_DATA_DIR to an absolute path or a project-relative path.',
);

if (!isValidPort(config.apiPort) || !isValidPort(config.webPort)) {
  report(
    'FAIL',
    `Invalid ports: PORT=${config.apiPort}, VITE_PORT=${config.webPort}.`,
    'Use distinct integers from 1 to 65535.',
  );
} else if (config.apiPort === config.webPort) {
  report(
    'FAIL',
    `PORT and VITE_PORT both resolve to ${config.apiPort}.`,
    'Choose distinct API and WebUI ports.',
  );
}

const available = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) =>
      resolve({ ok: false, code: error.code || 'unknown' }),
    );
    server.listen(port, '127.0.0.1', () =>
      server.close(() => resolve({ ok: true })),
    );
  });
if (isValidPort(config.apiPort) && isValidPort(config.webPort)) {
  for (const port of [config.apiPort, config.webPort]) {
    const result = await available(port);
    report(
      result.ok ? 'PASS' : 'WARN',
      `Port ${port} is ${result.ok ? 'available' : `in use (${result.code})`}.`,
      'Stop the owning service or select another port.',
    );
  }
}

try {
  runPnpmSync(['version:check'], { cwd: root, stdio: 'inherit' });
} catch {
  failures += 1;
}
if (failures) {
  console.error(`Doctor found ${failures} blocking problem(s).`);
  process.exit(1);
}
console.log('Doctor completed without blocking problems.');
