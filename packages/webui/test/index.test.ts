import { expect, test } from 'vitest';
import { createApp } from '../src/app';
import { Health } from '../src/health';
import { createMemoryItems } from '@proj/db';
import { createMemorySettingsRepository } from '@proj/db';
import { contract, initClient, StatusResponse, z } from '@proj/api';
import type { JsonObject } from '@proj/core';
const entries: {
  level: string;
  event: string;
  fields?: Record<string, unknown>;
}[] = [];
const logger = {
  log: (level: string, event: string, fields?: Record<string, unknown>) =>
    entries.push({ level, event, fields }),
  status: () => ({ ok: true }),
};
test('ts-rest client -> actual Hono app CRUD validates the shared contract', async () => {
  const { app } = createApp({ logger });
  const client = initClient(contract, {
    baseUrl: 'http://test',
    validateResponse: true,
    api: async (args) => {
      const r = await app.request(args.path, {
        method: args.method,
        headers: args.headers,
        body: args.body as string,
      });
      return { status: r.status, body: await r.json(), headers: r.headers };
    },
  });
  const added = await client.items.create({ body: { name: ' Alpha ' } });
  expect(added.status).toBe(201);
  if (added.status !== 201) throw Error();
  expect(added.body.name).toBe('Alpha');
  expect(
    (await client.items.list({ query: { search: 'alp' } })).body,
  ).toMatchObject({ total: 1 });
  expect(
    (
      await client.items.update({
        params: { id: added.body.id },
        body: { name: 'Beta' },
      })
    ).body,
  ).toMatchObject({ name: 'Beta' });
  expect(
    (await client.items.delete({ params: { id: added.body.id } })).status,
  ).toBe(200);
  expect((await client.items.list({ query: {} })).body).toMatchObject({
    total: 0,
  });
});
test('malformed JSON, validation, unknown API and missing items return safe correlated errors', async () => {
  const { app } = createApp({ logger });
  for (const [url, init, status] of [
    ['/api/items', { method: 'POST', body: '{' }, 400],
    ['/api/items?page=0', {}, 400],
    ['/api/missing', {}, 404],
    ['/api/items/missing', { method: 'PUT', body: '{"name":"x"}' }, 404],
  ] as const) {
    const r = await app.request(url, init);
    expect(r.status).toBe(status);
    const body = await r.json();
    expect(body.requestId).toBe(r.headers.get('X-Request-Id'));
    expect(body).not.toHaveProperty('stack');
  }
});
test('auth resolver is injectable and probes bypass business identity', async () => {
  const unauth = createApp({ logger, resolveActor: async () => null });
  expect((await unauth.app.request('/api/items')).status).toBe(401);
  expect((await unauth.app.request('/health/live')).status).toBe(200);
  const forbidden = createApp({
    logger,
    resolveActor: async () => ({ id: 'reader', canWrite: false }),
  });
  expect(
    (
      await forbidden.app.request('/api/items', {
        method: 'POST',
        body: '{"name":"x"}',
      })
    ).status,
  ).toBe(403);
});
test('application factory accepts an injected settings repository', async () => {
  const settingsRepository = createMemorySettingsRepository<JsonObject>({
    title: 'Local app',
  });
  const runtime = createApp({ logger, settingsRepository });
  const response = await runtime.app.request('/status');
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'settings-store', status: 'pass' }),
    ]),
  );
});
test('incompatible required settings prevent readiness without creating defaults', async () => {
  let saved = false;
  const runtime = createApp({
    logger,
    settingsRepository: {
      async load() {
        throw new Error('SETTINGS_VERSION_UNSUPPORTED');
      },
      async save() {
        saved = true;
      },
    },
    healthOptions: { cacheMs: 0, timeoutMs: 20, now: () => performance.now() },
  });
  const response = await runtime.app.request('/health/ready');
  expect(response.status).toBe(503);
  expect(saved).toBe(false);
});
test('repository exceptions and response contract drift fail with 500 rather than leaking internals', async () => {
  const repo = createMemoryItems();
  repo.create = async () => {
    throw new Error('password=never-output');
  };
  const { app } = createApp({ logger, repository: repo });
  let r = await app.request('/api/items', {
    method: 'POST',
    body: '{"name":"x"}',
  });
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain('never-output');
  repo.create = async () => ({
    id: 'broken',
    name: 'x',
    createdAt: 'not-a-date',
  });
  r = await app.request('/api/items', { method: 'POST', body: '{"name":"x"}' });
  expect(r.status).toBe(500);
});
test('startup, stopping, required failure and optional failure have distinct health outcomes', async () => {
  const runtime = createApp({
    logger,
    starting: true,
    healthOptions: { cacheMs: 0, timeoutMs: 10, now: () => performance.now() },
  });
  expect((await runtime.app.request('/health/ready')).status).toBe(503);
  runtime.health.start();
  const r = await runtime.app.request('/status');
  const data = StatusResponse.parse(await r.json());
  expect(data.status).toBe('healthy');
  expect(data.storage).toMatchObject({
    persistent: false,
    schemaVersion: null,
    schemaCompatibility: 'not_applicable',
  });
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  runtime.health.stop();
  expect((await runtime.app.request('/api/items')).status).toBe(503);
  for (const required of [true, false]) {
    const broken = createApp({
      logger,
      checks: [
        {
          name: 'fixture',
          required,
          run: async () => {
            throw Error();
          },
        },
      ],
    });
    const response = await broken.app.request('/status');
    expect(response.status).toBe(required ? 503 : 200);
    expect((await response.json()).status).toBe(
      required ? 'unhealthy' : 'degraded',
    );
  }
});
test('hanging dependency is bounded and never accumulates in-flight checks', async () => {
  let calls = 0;
  const health = new Health(
    [
      {
        name: 'hung',
        required: true,
        run: () => {
          calls++;
          return new Promise(() => {});
        },
      },
    ],
    logger,
    { timeoutMs: 10, cacheMs: 0, now: () => performance.now() },
  );
  health.start();
  const first = await health.snapshot();
  expect(first.status).toBe('unhealthy');
  expect(first.checks[0].code).toBe('CHECK_TIMEOUT');
  await Promise.all([health.snapshot(), health.snapshot()]);
  expect(calls).toBe(1);
});
test('successful probes do not create access log noise', async () => {
  entries.length = 0;
  const { app } = createApp({ logger });
  await app.request('/health/ready');
  await app.request('/health/ready');
  expect(entries.filter((e) => e.event === 'http.completed')).toHaveLength(0);
  expect(entries.filter((e) => e.event === 'health.changed')).toHaveLength(1);
});
test('cached health is bounded and status-change logs report recovery once', async () => {
  let now = 0,
    broken = true;
  const records: { event: string; fields?: Record<string, unknown> }[] = [];
  const sink = {
    log: (_level: string, event: string, fields?: Record<string, unknown>) =>
      records.push({ event, fields }),
    status: () => ({ ok: true }),
  };
  const health = new Health(
    [
      {
        name: 'external',
        required: false,
        run: async () => {
          if (broken) throw Error();
        },
      },
    ],
    sink,
    { timeoutMs: 10, cacheMs: 1000, now: () => now },
  );
  health.start();
  expect((await health.snapshot()).status).toBe('degraded');
  broken = false;
  now = 999;
  expect((await health.snapshot()).status).toBe('degraded');
  now = 1001;
  expect((await health.snapshot()).status).toBe('healthy');
  await health.snapshot();
  expect(records.filter((r) => r.event === 'health.changed')).toHaveLength(2);
  expect(records.at(-1)?.fields).toMatchObject({
    previous: 'degraded',
    status: 'healthy',
  });
});

test('internal syntax and schema errors remain server failures', async () => {
  for (const error of [new SyntaxError('private-detail'), new z.ZodError([])]) {
    const repository = createMemoryItems();
    repository.create = async () => { throw error; };
    const { app } = createApp({ logger, repository });
    const response = await app.request('/api/items', { method: 'POST', body: '{"name":"x"}' });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.requestId).toBe(response.headers.get('X-Request-Id'));
    expect(JSON.stringify(body)).not.toContain('private-detail');
  }
});
