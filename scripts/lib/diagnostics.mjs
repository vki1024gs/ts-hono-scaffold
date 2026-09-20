import { readFile } from 'node:fs/promises';
import { StatusResponse } from '../../packages/api/src/health.ts';
import { projectConfig } from './config.mjs';
export async function fetchBounded(
  url,
  { deadline = Date.now() + 2000, headers, method = 'GET' } = {},
) {
  const timeout = Math.max(1, Math.min(2000, deadline - Date.now())),
    controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers,
      method,
      signal: controller.signal,
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader)
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) throw new Error('RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    return {
      status: response.status,
      headers: response.headers,
      text: Buffer.concat(chunks).toString('utf8'),
    };
  } finally {
    clearTimeout(timer);
  }
}
export async function control(
  state,
  action = 'status',
  deadline = Date.now() + 2000,
) {
  const response = await fetchBounded(
    'http://127.0.0.1:' + state.controlPort + '/' + action,
    {
      headers: { Authorization: 'Bearer ' + state.controlToken },
      method: action === 'stop' ? 'POST' : 'GET',
      deadline,
    },
  );
  if (response.status !== 200) throw new Error('CONTROL_UNAVAILABLE');
  const value = JSON.parse(response.text);
  if (value.instanceId !== state.instanceId || value.pid !== state.pid)
    throw new Error('INSTANCE_MISMATCH');
  return value;
}
export function validateState(state, root) {
  if (
    state.schemaVersion !== 1 ||
    state.projectRoot !== root ||
    !Number.isInteger(state.pid) ||
    state.pid < 1 ||
    !Number.isInteger(state.controlPort) ||
    !Number.isInteger(state.apiPort) ||
    !Number.isInteger(state.webPort) ||
    typeof state.apiHost !== 'string' ||
    typeof state.webHost !== 'string' ||
    [state.apiPort, state.webPort, state.controlPort].some(
      (p) => p < 1 || p > 65535,
    ) ||
    typeof state.controlToken !== 'string' ||
    typeof state.instanceId !== 'string'
  )
    throw new Error('STATE_INVALID');
  return state;
}
export async function diagnose(
  root,
  state,
  { deadline = Date.now() + 5000 } = {},
) {
  const config = projectConfig(root);
  const checks = [],
    started = performance.now();
  const add = (name, status, code, next) =>
    checks.push({
      name,
      status,
      code,
      next,
      checkedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
    });
  let marker;
  try {
    marker = JSON.parse(
      await readFile(config.buildInfoFile, 'utf8'),
    );
  } catch {
    add('build', 'fail', 'BUILD_MISSING', 'Run pnpm build and restart.');
  }
  await Promise.all([
    (async () => {
      try {
        const value = await control(state, 'status', deadline);
        add('instance', 'pass', 'PASS', '');
        const fresh = Date.now() - Date.parse(value.logging.updatedAt) < 15000;
        add(
          'logging',
          value.logging.ok && fresh ? 'pass' : 'warn',
          fresh ? value.logging.code : 'LOG_STATUS_STALE',
          'Inspect app:logs and available disk space.',
        );
      } catch {
        add(
          'instance',
          'fail',
          'INSTANCE_UNAVAILABLE',
          'Inspect managed state; do not kill a port owner.',
        );
      }
    })(),
    (async () => {
      try {
        const response = await fetchBounded(
          'http://' +
            (state.apiHost === '0.0.0.0' ? '127.0.0.1' : state.apiHost) +
            ':' +
            state.apiPort +
            '/status',
          { deadline },
        );
        const value = StatusResponse.parse(JSON.parse(response.text));
        const serving =
          value.status === 'healthy' || value.status === 'degraded';
        if (response.status !== (serving ? 200 : 503))
          throw new Error('HEALTH_HTTP_MISMATCH');
        add(
          'api',
          value.status === 'healthy'
            ? 'pass'
            : value.status === 'degraded'
              ? 'warn'
              : 'fail',
          value.status,
          'Inspect API checks and logs.',
        );
        for (const check of value.checks)
          if (check.status === 'fail' || check.status === 'warn')
            add(
              'api.' + check.name,
              check.required ? 'fail' : 'warn',
              check.code,
              'Inspect app:logs using requestId ' + value.requestId + '.',
            );
        const matches =
          marker &&
          ['version', 'revision', 'builtAt', 'buildId']
            .filter((k) => k !== 'buildId')
            .every(
              (k) =>
                value[k] === marker[k] &&
                !['unknown', 'development', ''].includes(value[k]),
            ) &&
          value.instanceId === state.instanceId;
        add(
          'api.identity',
          matches ? 'pass' : 'fail',
          matches ? 'PASS' : 'BUILD_OR_INSTANCE_MISMATCH',
          'Run pnpm app:restart.',
        );
      } catch {
        add(
          'api',
          'fail',
          'API_UNAVAILABLE_OR_INVALID',
          'Inspect API logs and configured address.',
        );
      }
    })(),
    (async () => {
      try {
        const origin =
            'http://' +
            (state.webHost === '0.0.0.0' ? '127.0.0.1' : state.webHost) +
            ':' +
            state.webPort,
          response = await fetchBounded(origin + '/', { deadline });
        if (
          response.status !== 200 ||
          !response.headers.get('content-type')?.includes('text/html') ||
          !marker?.buildId ||
          !response.text.includes(
            'name="app-build" content="' + marker.buildId + '"',
          )
        )
          throw new Error('WEB_IDENTITY');
        const asset = response.text.match(
          /<script[^>]+src="(\/assets\/[^"?]+\.js)"/,
        );
        if (!asset) throw new Error('WEB_ASSET');
        const js = await fetchBounded(origin + asset[1], { deadline });
        if (
          js.status !== 200 ||
          !/(javascript|ecmascript)/.test(
            js.headers.get('content-type') || '',
          ) ||
          js.text.startsWith('<!')
        )
          throw new Error('WEB_ASSET');
        add('webui', 'pass', 'PASS', '');
      } catch {
        add(
          'webui',
          'fail',
          'WEBUI_BUILD_OR_ASSET_INVALID',
          'Build and restart WebUI; check its logs.',
        );
      }
    })(),
  ]);
  const code = checks.some((c) => c.status === 'fail')
    ? 1
    : checks.some((c) => c.status === 'warn')
      ? 2
      : 0;
  return {
    schemaVersion: 1,
    status: code === 0 ? 'healthy' : code === 2 ? 'degraded' : 'unhealthy',
    exitCode: code,
    instanceId: state.instanceId,
    timestamp: new Date().toISOString(),
    durationMs: performance.now() - started,
    logDirectory: 'logs',
    checks,
  };
}
