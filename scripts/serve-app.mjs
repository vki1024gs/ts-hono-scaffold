import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';
import { LogSink, eventRecord, levels } from './lib/logging.mjs';
const scriptPath = fileURLToPath(import.meta.url),
  root = path.resolve(path.dirname(scriptPath), '..');
export function serviceCommands(workspaceRoot, environment = process.env) {
  const { apiPort, env } = projectConfig(workspaceRoot, environment);
  return [
    {
      service: 'api',
      command: process.execPath,
      args: [path.join(workspaceRoot, 'packages/webui/dist/index.mjs')],
      cwd: path.join(workspaceRoot, 'packages/webui'),
      env: { ...env, PORT: String(apiPort) },
    },
    {
      service: 'webui',
      command: process.execPath,
      args: [path.join(workspaceRoot, 'scripts/serve-static.mjs')],
      cwd: workspaceRoot,
      env,
    },
  ];
}
async function serve() {
  const config = projectConfig(root),
    marker = JSON.parse(await readFile(config.buildInfoFile, 'utf8'));
  const instanceId = process.env.APP_INSTANCE_ID,
    token = process.env.APP_CONTROL_TOKEN;
  if (!instanceId || !token)
    throw new Error('Managed launch credentials missing');
  const identity = {
    service: 'supervisor',
    instanceId,
    version: marker.version,
    revision: marker.revision,
  };
  const sink = await new LogSink(config.dataDir, identity, {
    level: config.env.LOG_LEVEL,
  }).open();
  const emit = (level, event, fields) =>
    sink.enqueue(eventRecord(identity, level, event, fields));
  const children = [];
  let stopping = false;
  let heartbeat;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    emit('info', 'app.stopping');
    for (const [index, child] of children.entries()) {
      if (index === 0 && child.connected) child.send('shutdown');
      else child.kill('SIGTERM');
    }
    const until = Date.now() + 5000;
    while (
      children.some(
        (child) => child.exitCode === null && child.signalCode === null,
      ) &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 50));
    const remaining = children.filter(
      (child) => child.exitCode === null && child.signalCode === null,
    );
    if (remaining.length) {
      emit('fatal', 'app.forced_stop', { code: 'SHUTDOWN_TIMEOUT' });
      for (const child of remaining) child.kill('SIGKILL');
      code = 1;
    }
    emit('info', 'app.stopped');
    await sink.close(1000);
    server.close();
    server.closeAllConnections();
    try {
      const saved = JSON.parse(await readFile(config.stateFile, 'utf8'));
      if (saved.instanceId === instanceId) await unlink(config.stateFile);
    } catch {}
    process.exit(code);
  }
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        schemaVersion: 1,
        instanceId,
        pid: process.pid,
        logging: sink.snapshot(),
        stopping,
        children: children.map((child, i) => ({
          pid: child.pid,
          service: i === 0 ? 'api' : 'webui',
        })),
      }),
    );
    if (req.url === '/ready') emit('info', 'app.ready');
    if (req.url === '/stop' && req.method === 'POST') void stop();
  });
  server.requestTimeout = 2000;
  server.headersTimeout = 2000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const state = {
    schemaVersion: 1,
    pid: process.pid,
    projectRoot: root,
    instanceId,
    controlToken: token,
    controlPort: server.address().port,
    apiPort: config.apiPort,
    webPort: config.webPort,
    apiHost: config.apiHost,
    webHost: config.webHost,
    ...marker,
    startedAt: new Date().toISOString(),
  };
  await writeFile(
    config.stateFile + '.tmp',
    JSON.stringify(state, null, 2) + '\n',
    { mode: 0o600 },
  );
  await rename(config.stateFile + '.tmp', config.stateFile);
  emit('info', 'app.starting');
  for (const definition of serviceCommands(root)) {
    const child = spawn(definition.command, definition.args, {
      cwd: definition.cwd,
      env: {
        ...definition.env,
        APP_INSTANCE_ID: instanceId,
        APP_REVISION: marker.revision,
        APP_BUILT_AT: marker.builtAt,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    children.push(child);
    for (const stream of ['stdout', 'stderr']) {
      let pending = Buffer.alloc(0);
      child[stream].on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        let newline;
        const receive = (buffer) => {
          if (definition.service === 'api' && stream === 'stdout') {
            try {
              const value = JSON.parse(buffer.toString());
              if (
                value.schemaVersion === 1 &&
                levels.includes(value.level) &&
                levels.indexOf(value.level) >=
                  levels.indexOf(config.env.LOG_LEVEL)
              )
                sink.enqueue(
                  eventRecord(
                    {
                      ...identity,
                      service: 'api',
                      pid: child.pid,
                      timestamp: value.timestamp,
                    },
                    value.level,
                    value.event,
                    value,
                  ),
                );
              return;
            } catch {}
          }
          if (stream === 'stderr')
            sink.enqueue(
              eventRecord(
                { ...identity, service: definition.service },
                'warn',
                'tool.output',
                { stream },
              ),
            );
        };
        while ((newline = pending.indexOf(10)) >= 0) {
          receive(pending.subarray(0, newline));
          pending = pending.subarray(newline + 1);
        }
        if (pending.length > 16384) {
          receive(Buffer.alloc(0));
          pending = Buffer.alloc(0);
        }
      });
    }
    child.once('error', () => {
      emit('fatal', 'app.startup_failed', { code: 'STARTUP_FAILED' });
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      emit(stopping ? 'info' : 'error', 'app.child_exited', {
        exitCode: code,
        signal,
        code: 'CHILD_EXITED',
        childService: definition.service,
        childPid: child.pid,
      });
      if (!stopping) void stop(1);
    });
  }
  heartbeat = setInterval(() => {
    void sink.flush(100);
  }, 5000);
  heartbeat.unref();
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  process.once('uncaughtException', () => void stop(1));
  process.once('unhandledRejection', () => void stop(1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath)
  serve().catch(() => {
    process.stderr.write('SUPERVISOR_STARTUP_FAILED\n');
    process.exitCode = 1;
  });
