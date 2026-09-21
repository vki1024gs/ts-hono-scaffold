import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchBounded, diagnose } from './lib/diagnostics.mjs';
import { projectConfig } from './lib/config.mjs';
async function server(handler, fn) {
  const srv = createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await fn(srv.address().port);
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
}
test('HTTP deadline covers both missing headers and a hanging body', async () => {
  for (const body of [true, false])
    await server(
      (_req, res) => {
        if (body) {
          res.writeHead(200);
          res.write('partial');
        }
      },
      async (port) => {
        const start = performance.now();
        await assert.rejects(
          fetchBounded('http://127.0.0.1:' + port, {
            deadline: Date.now() + 50,
          }),
        );
        assert.ok(performance.now() - start < 500);
      },
    );
});
test('environment overrides env file; invalid ports and mode fail explicitly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scaffold-config-'));
  try {
    await writeFile(
      path.join(root, 'package.json'),
      '{"name":"@fixture/workspace"}',
    );
    await writeFile(
      path.join(root, '.env'),
      'PORT=10001\nVITE_PORT=10002\nLOG_LEVEL=warn\n',
    );
    assert.equal(projectConfig(root, { PORT: '10003' }).apiPort, 10003);
    assert.equal(projectConfig(root, {}).env.LOG_LEVEL, 'warn');
    assert.throws(() => projectConfig(root, { PORT: '12x' }));
    assert.throws(() => projectConfig(root, { PORT: '10002' }));
    assert.throws(() => projectConfig(root, { AUTH_MODE: 'production' }));
    assert.throws(() => projectConfig(root, { LOG_LEVEL: 'all' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('HTTP 200 alone cannot pass whole-app diagnosis', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'scaffold-diagnose-'));
  try {
    await writeFile(
      path.join(root, 'package.json'),
      '{"name":"@fixture/workspace"}',
    );
    await writeFile(path.join(root, '.env'), 'APP_DATA_DIR=.runtime\n');
    await mkdir(path.join(root, '.runtime'));
    await mkdir(path.join(root, 'dist'));
    await writeFile(
      path.join(root, 'dist/build-info.json'),
      JSON.stringify({
        version: '0.3.1',
        revision: 'fixture',
        builtAt: new Date().toISOString(),
        buildId: 'fixture',
      }),
    );
    await server(
      (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html>Wrong application</html>');
      },
      async (port) => {
        const result = await diagnose(root, {
          apiPort: port,
          webPort: port,
          apiHost: '127.0.0.1',
          webHost: '127.0.0.1',
          controlPort: port,
          controlToken: 'fixture',
          instanceId: 'fixture',
          pid: process.pid,
        });
        assert.equal(result.exitCode, 1);
        assert.ok(result.checks.filter((c) => c.status === 'fail').length >= 3);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
