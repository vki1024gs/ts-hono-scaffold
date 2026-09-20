import { spawn } from 'node:child_process';
import { open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';
import { control, diagnose, validateState } from './lib/diagnostics.mjs';
import {
  LogSink,
  eventRecord,
  readLogs,
  cleanLogs,
  ensureDataDirectory,
  ensureLogDirectory,
} from './lib/logging.mjs';
import { withOperationLock } from './lib/operation-lock.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  config = projectConfig(root),
  stateFile = config.stateFile;
const command = process.argv[2],
  args = process.argv.slice(3),
  json = args.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function readState() {
  try {
    return validateState(JSON.parse(await readFile(stateFile, 'utf8')), root);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function stop() {
  const state = await readState();
  if (!state) {
    if (!json) console.log('Application is stopped.');
    return { outcome: 'already_stopped', state: null };
  }
  if (!alive(state.pid)) {
    await unlink(stateFile);
    return { outcome: 'already_stopped', state: null };
  }
  await control(state, 'stop');
  const deadline = Date.now() + 7000;
  while (alive(state.pid) && Date.now() < deadline) await sleep(50);
  if (alive(state.pid))
    throw new Error(
      'SHUTDOWN_TIMEOUT: Managed instance did not stop; inspect diagnostics.',
    );
  if (!json) console.log('Application stopped.');
  return { outcome: 'succeeded', state };
}
const available = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
async function start() {
  await ensureDataDirectory(config.dataDir);
  await ensureLogDirectory(config.dataDir);
  const attemptId = randomUUID();
  let buildSink, child, instanceId;
  try {
    const current = await readState();
    if (current && alive(current.pid)) {
      if (!json) console.log('Application is already running.');
      return { ...current, alreadyRunning: true };
    }
    if (current) await unlink(stateFile);
    for (const port of [config.apiPort, config.webPort])
      if (!(await available(port)))
        throw new Error(
          'PORT_OCCUPIED: Choose a free port; the owner was not changed.',
        );
    const identity = {
      service: 'build',
      attemptId,
      instanceId: 'unknown',
      version: config.rootPackage.version,
      revision: 'building',
    };
    buildSink = await new LogSink(config.dataDir, identity, {
      level: config.env.LOG_LEVEL,
    }).open();
    buildSink.enqueue(eventRecord(identity, 'info', 'app.starting'));
    await new Promise((resolve, reject) => {
      const build = spawn(
        process.execPath,
        [path.join(root, 'scripts/build.mjs')],
        {
          cwd: root,
          env: config.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      for (const stream of ['stdout', 'stderr'])
        build[stream].on('data', () =>
          buildSink.enqueue(
            eventRecord(
              identity,
              stream === 'stderr' ? 'warn' : 'info',
              'tool.output',
              { stream },
            ),
          ),
        );
      build.once('error', reject);
      build.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                'BUILD_FAILED: Run pnpm build for compiler diagnostics.',
              ),
            ),
      );
    });
    await buildSink.close();
    buildSink = null;
    instanceId = randomUUID();
    child = spawn(
      process.execPath,
      [path.join(root, 'scripts/serve-app.mjs')],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...config.env,
          APP_INSTANCE_ID: instanceId,
          APP_CONTROL_TOKEN: randomUUID(),
        },
      },
    );
    child.unref();
    const deadline = Date.now() + 15000;
    let result;
    while (Date.now() < deadline) {
      if (!alive(child.pid))
        throw new Error('SUPERVISOR_EXITED: Inspect app:logs.');
      const state = await readState();
      if (state?.instanceId === instanceId) {
        result = await diagnose(root, state, {
          deadline: Math.min(deadline, Date.now() + 5000),
        });
        if (result.exitCode === 0) {
          await control(state, 'ready', deadline);
          if (!json) console.log('Application started. WebUI: ' + config.webOrigin);
          return state;
        }
      }
      await sleep(Math.min(200, Math.max(0, deadline - Date.now())));
    }
    throw new Error(
      'STARTUP_TIMEOUT: ' +
        (result
          ? JSON.stringify(result.checks)
          : 'Managed state not available'),
    );
  } catch (error) {
    if (buildSink) {
      buildSink.enqueue(
        eventRecord(
          {
            service: 'build',
            attemptId,
            instanceId: 'unknown',
            version: 'unknown',
            revision: 'unknown',
          },
          'error',
          'app.startup_failed',
          { code: 'STARTUP_FAILED' },
        ),
      );
      await buildSink.close();
    }
    if (child) {
      const state = await readState().catch(() => null);
      if (state?.instanceId === instanceId) await stop().catch(() => {});
      else if (alive(child.pid)) child.kill('SIGTERM');
    }
    throw error;
  }
}
const effectiveEndpoints = (state) => {
  const observedAt = new Date().toISOString();
  const availability = state ? 'resolved' : 'configured';
  const source = state ? 'running_instance' : 'configuration';
  return [
    {
      id: 'webui',
      label: 'WebUI',
      scheme: 'http',
      host: state?.webHost ?? config.webHost,
      port: state?.webPort ?? config.webPort,
      availability,
      source,
      observedAt,
    },
    {
      id: 'api',
      label: 'API',
      scheme: 'http',
      host: state?.apiHost ?? config.apiHost,
      port: state?.apiPort ?? config.apiPort,
      availability,
      source,
      observedAt,
    },
  ];
};
const runLocked = async (action, operation) => {
  await ensureDataDirectory(config.dataDir);
  return withOperationLock({
    action,
    lockFile: config.startLockFile,
    projectRoot: root,
    operation,
  });
};
const actionResult = (action, outcome, state) => ({
  schemaVersion: 1,
  action,
  outcome,
  timestamp: new Date().toISOString(),
  instanceId: state?.instanceId,
  effectiveEndpoints: effectiveEndpoints(state),
});
function logOptions() {
  const options = {};
  const names = {
    '--lines': 'lines',
    '--level': 'level',
    '--service': 'service',
    '--request-id': 'requestId',
    '--instance-id': 'instanceId',
    '--since': 'since',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') continue;
    const name = names[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Invalid log option');
    options[name] = name === 'lines' ? Number(args[++i]) : args[++i];
  }
  return options;
}
try {
  if (command === 'start') {
    const state = await runLocked('start', start);
    if (json)
      console.log(
        JSON.stringify(
          actionResult(
            'start',
            state.alreadyRunning ? 'already_running' : 'succeeded',
            state,
          ),
        ),
      );
  } else if (command === 'stop') {
    const result = await runLocked('stop', stop);
    if (json)
      console.log(
        JSON.stringify(actionResult('stop', result.outcome, result.state)),
      );
  } else if (command === 'restart') {
    const state = await runLocked('restart', async () => {
      await stop();
      return start();
    });
    if (json)
      console.log(JSON.stringify(actionResult('restart', 'succeeded', state)));
  } else if (command === 'status') {
    const state = await readState();
    let result = state
      ? await diagnose(root, state)
      : {
          schemaVersion: 1,
          status: 'stopped',
          exitCode: 1,
          checks: [],
          timestamp: new Date().toISOString(),
        };
    if (state) {
      result.configurationChanged =
        config.apiPort !== state.apiPort || config.webPort !== state.webPort;
    }
    result.action = 'status';
    result.outcome = 'succeeded';
    result.effectiveEndpoints = effectiveEndpoints(state);
    console.log(
      json
        ? JSON.stringify(result, null, 2)
        : [
            result.status,
            ...result.checks.map(
              (c) =>
                c.name +
                ': ' +
                c.status +
                ' (' +
                c.code +
                ')' +
                (c.status !== 'pass' ? ' — ' + c.next : ''),
            ),
            result.configurationChanged
              ? 'Configuration changed; using recorded running ports.'
              : '',
            'Logs: configured application data directory',
          ]
            .filter(Boolean)
            .join('\n'),
    );
    process.exitCode = result.exitCode;
  } else if (command === 'logs') {
    const result = await readLogs(config.dataDir, logOptions());
    result.action = 'logs';
    result.outcome = 'succeeded';
    result.timestamp = new Date().toISOString();
    try {
      const legacy = await open(config.legacyLogFile, 'r');
      const stat = await legacy.stat();
      await legacy.close();
      result.legacy = { path: 'app.log', bytes: stat.size };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    console.log(
      json
        ? JSON.stringify(result, null, 2)
        : result.events.map((e) => JSON.stringify(e)).join('\n'),
    );
    if (result.legacy && !json)
      console.error(
        'Legacy app.log exists in the application data directory; raw contents are not included.',
      );
    if (result.scanTruncated && !json)
      console.error('Scan budget reached; results are incomplete.');
  } else if (command === 'logs-clean') {
    if (
      args.some((a) => !['--dry-run', '--apply', '--json'].includes(a)) ||
      (args.includes('--dry-run') && args.includes('--apply'))
    )
      throw new Error('Use --dry-run or --apply');
    console.log(
      JSON.stringify(
        await cleanLogs(config.dataDir, !args.includes('--apply')),
        null,
        2,
      ),
    );
  } else
    throw new Error('Usage: app.mjs start|stop|restart|status|logs|logs-clean');
} catch (error) {
  const code = String(error.message || '').split(':', 1)[0] || 'COMMAND_FAILED';
  const result = {
    schemaVersion: 1,
    action: command,
    status: 'error',
    outcome: code === 'OPERATION_BUSY' ? 'busy' : 'failed',
    code,
    message: error.message,
    timestamp: new Date().toISOString(),
  };
  if (json) console.log(JSON.stringify(result));
  else console.error(error.message);
  process.exitCode = 3;
}
