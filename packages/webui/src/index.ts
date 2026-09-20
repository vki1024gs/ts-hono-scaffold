import { serve } from '@hono/node-server';
import { z } from '@proj/api';
import { APP_VERSION } from '@proj/core';
import { createLogger } from '../../../scripts/lib/logging.mjs';
import { createApp } from './app';
const parsed = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(18080),
    HOST: z.string().default('127.0.0.1'),
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    AUTH_MODE: z.enum(['none', 'dev']).optional(),
  })
  .safeParse(process.env);
if (!parsed.success) {
  process.stderr.write(
    'CONFIG_INVALID: Check HOST, PORT, LOG_LEVEL and AUTH_MODE.\n',
  );
  process.exit(1);
}
const config = parsed.data;
const identity = {
  version: APP_VERSION,
  revision: process.env.APP_REVISION || 'development',
  builtAt: process.env.APP_BUILT_AT || 'development',
  instanceId: process.env.APP_INSTANCE_ID || crypto.randomUUID(),
};
const logger = createLogger(
  { service: 'api', ...identity },
  { level: config.LOG_LEVEL },
);
const runtime = createApp({ identity, logger, starting: true });
logger.log('info', 'app.starting');
const server = serve(
  { fetch: runtime.app.fetch, port: config.PORT, hostname: config.HOST },
  () => {
    runtime.health.start();
    logger.log('info', 'app.ready');
  },
);
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  runtime.health.stop();
  logger.log('info', 'app.stopping');
  const deadline = setTimeout(() => {
    logger.log('fatal', 'app.forced_stop', { code: 'SHUTDOWN_TIMEOUT' });
    if ('closeAllConnections' in server) server.closeAllConnections();
    process.exit(1);
  }, 6000);
  server.close(() => {
    clearTimeout(deadline);
    logger.log('info', 'app.stopped');
    if (process.connected) process.disconnect();
    process.exitCode = code;
  });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}
server.on('error', () => {
  logger.log('fatal', 'app.startup_failed', { code: 'STARTUP_FAILED' });
  void stop(1);
});
process.once('SIGTERM', () => void stop(0));
process.once('SIGINT', () => void stop(0));
process.on('message', (message) => {
  if (message === 'shutdown') void stop(0);
});
process.once('uncaughtException', () => {
  logger.log('fatal', 'http.failed', { code: 'INTERNAL_ERROR' });
  void stop(1);
});
process.once('unhandledRejection', () => {
  logger.log('fatal', 'http.failed', { code: 'INTERNAL_ERROR' });
  void stop(1);
});
