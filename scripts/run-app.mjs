import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { projectConfig } from './lib/config.mjs';
import { serviceCommands } from './serve-app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
const marker = JSON.parse(await readFile(config.buildInfoFile, 'utf8'));
const instanceId = process.env.APP_INSTANCE_ID || randomUUID();
const children = [];
let stopping = false;
let exitCode = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emit = (type, fields = {}) =>
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      type,
      timestamp: new Date().toISOString(),
      instanceId,
      ...fields,
    })}\n`,
  );

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = Math.max(exitCode, code);
  emit('service.stopping');
  for (const [index, child] of children.entries()) {
    if (index === 0 && child.connected) child.send('shutdown');
    else child.kill('SIGTERM');
  }
  const deadline = Date.now() + 6000;
  while (
    children.some(
      (child) => child.exitCode === null && child.signalCode === null,
    ) &&
    Date.now() < deadline
  )
    await sleep(50);
  const remaining = children.filter(
    (child) => child.exitCode === null && child.signalCode === null,
  );
  if (remaining.length) {
    exitCode = 1;
    for (const child of remaining) child.kill('SIGKILL');
  }
  emit('service.stopped', { outcome: exitCode === 0 ? 'succeeded' : 'failed' });
  process.exit(exitCode);
}

async function ready() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (
      children.some(
        (child) => child.exitCode !== null || child.signalCode !== null,
      )
    )
      throw new Error('CHILD_EXITED');
    try {
      const [api, web] = await Promise.all([
        fetch(config.apiOrigin + '/health/ready', {
          signal: AbortSignal.timeout(1000),
        }),
        fetch(config.webOrigin + '/', { signal: AbortSignal.timeout(1000) }),
      ]);
      if (api.ok && web.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('STARTUP_TIMEOUT');
}

try {
  emit('service.starting', {
    mode: 'foreground',
    version: marker.version,
    revision: marker.revision,
  });
  for (const definition of serviceCommands(root)) {
    const child = spawn(definition.command, definition.args, {
      cwd: definition.cwd,
      env: {
        ...definition.env,
        APP_INSTANCE_ID: instanceId,
        APP_REVISION: marker.revision,
        APP_BUILT_AT: marker.builtAt,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    children.push(child);
    child.once('error', () => void stop(1));
    child.once('exit', (code) => {
      if (!stopping) void stop(code === 0 ? 1 : code || 1);
    });
  }
  process.once('SIGINT', () => void stop(0));
  process.once('SIGTERM', () => void stop(0));
  process.on('message', (message) => {
    if (message === 'shutdown') void stop(0);
  });
  await ready();
  emit('service.ready', {
    effectiveEndpoints: [
      {
        id: 'webui',
        label: 'WebUI',
        scheme: 'http',
        host: config.webHost,
        port: config.webPort,
      },
      {
        id: 'api',
        label: 'API',
        scheme: 'http',
        host: config.apiHost,
        port: config.apiPort,
      },
    ],
  });
} catch (error) {
  emit('service.failed', {
    code: error instanceof Error ? error.message : 'STARTUP_FAILED',
  });
  await stop(1);
}
