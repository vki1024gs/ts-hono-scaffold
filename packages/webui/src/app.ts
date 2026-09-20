import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  contract,
  ItemListQuery,
  IdPathParams,
  CreateItemBody,
  UpdateItemBody,
  ErrorResponse,
  StatusResponse,
  z,
} from '@proj/api';
import type { ServerInferResponses, HealthStatus } from '@proj/api';
import { createMemoryItems } from '@proj/db';
import type { ItemsRepository } from '@proj/db';
import type { Actor, JsonObject, SettingsRepository } from '@proj/core';
import { APP_VERSION } from '@proj/core';
import { createLogger } from '../../../scripts/lib/logging.mjs';
import type { Logger } from '../../../scripts/lib/logging.mjs';
import { Health } from './health';
import type { Check } from './health';
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function parseRequest<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'INVALID_REQUEST', 'Request does not match the API contract');
  return parsed.data;
}
export async function requestJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(400, 'INVALID_REQUEST', 'Malformed JSON request');
  }
}
export type AppOptions = {
  repository?: ItemsRepository;
  settingsRepository?: SettingsRepository<JsonObject>;
  resolveActor?: (request: Request) => Promise<Actor | null>;
  logger?: Logger;
  checks?: Check[];
  identity?: {
    version: string;
    revision: string;
    builtAt: string;
    instanceId: string;
  };
  starting?: boolean;
  healthOptions?: { timeoutMs: number; cacheMs: number; now: () => number };
};
export type AppEnv = { Variables: { requestId: string; streaming?: boolean } };
type Env = AppEnv;
export function createApp(options: AppOptions = {}) {
  const identity = options.identity ?? {
    version: APP_VERSION,
    revision: 'development',
    builtAt: 'development',
    instanceId: crypto.randomUUID(),
  };
  const logger =
    options.logger ?? createLogger({ service: 'api', ...identity });
  const repository = options.repository ?? createMemoryItems();
  const health = new Health(
    [
      { name: 'configuration', required: true, run: async () => {} },
      {
        name: 'repository',
        required: true,
        run: async () => {
          await repository.list();
        },
      },
      {
        name: 'logging',
        required: false,
        run: async () => {
          if (!logger.status().ok) throw new Error('LOG_SINK_UNAVAILABLE');
        },
      },
      ...(options.settingsRepository
        ? [
            {
              name: 'settings-store',
              required: true,
              run: async () => {
                await options.settingsRepository?.load();
              },
            },
          ]
        : []),
      ...(options.checks ?? []),
    ],
    logger,
    options.healthOptions,
  );
  if (!options.starting) health.start();
  const app = new Hono<Env>();
  let active = 0;
  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    const start = performance.now();
    active++;
    try {
      await next();
    } finally {
      active--;
      const route = c.req.routePath || 'unmatched';
      if (
        !c.get('streaming') &&
        !['/status', '/health/live', '/health/ready'].includes(route)
      )
        logger.log(
          c.res.status >= 500
            ? 'error'
            : c.res.status === 401 ||
                c.res.status === 403 ||
                performance.now() - start >= 1000
              ? 'warn'
              : 'info',
          'http.completed',
          {
            requestId,
            method: c.req.method,
            route: route === '/*' || route === '*' ? 'unmatched' : route,
            statusCode: c.res.status,
            durationMs: performance.now() - start,
            outcome: c.res.status >= 500 ? 'failed' : 'completed',
          },
        );
    }
  });
  app.onError((error, c) => {
    const known = error instanceof AppError;
    const status = known ? error.status : 500;
    if (status === 500)
      logger.log('error', 'http.failed', {
        requestId: c.get('requestId'),
        error: { code: 'INTERNAL_ERROR' },
      });
    return c.json(
      ErrorResponse.parse({
        error: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
        requestId: c.get('requestId'),
      }),
      status,
    );
  });
  app.notFound((c) =>
    c.json(
      {
        error: 'NOT_FOUND',
        message: 'Route not found',
        timestamp: new Date().toISOString(),
        requestId: c.get('requestId'),
      },
      404,
    ),
  );
  const probe = async (c: Context<Env>, details = false) => {
    const snapshot = await health.snapshot(),
      timestamp = new Date().toISOString();
    const code =
      snapshot.status === 'healthy' || snapshot.status === 'degraded'
        ? 200
        : 503;
    c.header('Cache-Control', 'no-store');
    const minimal = {
      schemaVersion: 1 as const,
      status: snapshot.status,
      timestamp,
      requestId: c.get('requestId'),
    };
    if (!details) return c.json(minimal, code);
    const uptime = process.uptime();
    const body: HealthStatus = {
      ...minimal,
      ...identity,
      service: 'api',
      uptime,
      uptimeSeconds: uptime,
      checks: snapshot.checks,
      storage: {
        kind: 'memory',
        persistent: false,
        schemaVersion: null,
        schemaCompatibility: 'not_applicable',
      },
      databaseSchema: null,
    };
    return c.json(StatusResponse.parse(body), code);
  };
  app.get(contract.health.live.path, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      schemaVersion: 1 as const,
      status: 'healthy' as const,
      timestamp: new Date().toISOString(),
      requestId: c.get('requestId'),
    });
  });
  app.get(contract.health.ready.path, (c) => probe(c));
  app.get(contract.status.check.path, (c) => probe(c, true));
  app.use('/api/*', async (c, next) => {
    if (health.phase !== 'running')
      throw new AppError(
        503,
        'NOT_READY',
        'Application is starting or stopping',
      );
    if (options.resolveActor) {
      const actor = await options.resolveActor(c.req.raw);
      if (!actor)
        throw new AppError(401, 'UNAUTHORIZED', 'Identity is required');
      if (c.req.method !== 'GET' && !actor.canWrite)
        throw new AppError(403, 'FORBIDDEN', 'Write access is required');
    }
    await next();
  });
  // One small JSON boundary: route definitions and response schemas come from the contract.
  type ItemKey = 'list' | 'create' | 'update' | 'delete';
  function respond<K extends ItemKey>(
    c: Context<Env>,
    key: K,
    result: ServerInferResponses<(typeof contract.items)[K]>,
  ): Response;
  function respond(c: Context<Env>, key: ItemKey, raw: unknown): Response {
    const result = z
      .object({ status: z.number(), body: z.unknown() })
      .parse(raw);
    const schemas: Record<number, z.ZodTypeAny> = contract.items[key].responses;
    const parsed = schemas[result.status].safeParse(result.body);
    if (!parsed.success) throw new Error('Response contract violation');
    const body = parsed.data;
    return c.json(body, result.status as ContentfulStatusCode);
  }
  app.get(contract.items.list.path, async (c) => {
    const query = parseRequest(ItemListQuery, c.req.query());
    const values = (await repository.list())
      .filter((item) =>
        item.name.toLowerCase().includes(query.search.toLowerCase()),
      )
      .sort((a, b) => {
        const order =
          a[query.sort].localeCompare(b[query.sort]) ||
          a.id.localeCompare(b.id);
        return query.order === 'asc' ? order : -order;
      });
    const start = (query.page - 1) * query.limit;
    return respond(c, 'list', {
      status: 200,
      body: {
        items: values.slice(start, start + query.limit),
        total: values.length,
        page: query.page,
        limit: query.limit,
        hasMore: start + query.limit < values.length,
      },
    });
  });
  app.post(contract.items.create.path, async (c) => {
    const input = parseRequest(CreateItemBody, await requestJson(c));
    return respond(c, 'create', {
      status: 201,
      body: await repository.create(input.name),
    });
  });
  app.put(contract.items.update.path, async (c) => {
    const { id } = parseRequest(IdPathParams, c.req.param()),
      input = parseRequest(UpdateItemBody, await requestJson(c));
    const item = await repository.update(id, input.name);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    return respond(c, 'update', { status: 200, body: item });
  });
  app.delete(contract.items.delete.path, async (c) => {
    const { id } = parseRequest(IdPathParams, c.req.param());
    if (!(await repository.delete(id)))
      throw new AppError(404, 'NOT_FOUND', 'Item not found');
    return respond(c, 'delete', { status: 200, body: { status: 'deleted' } });
  });
  return { app, health, activeRequests: () => active, logger };
}
