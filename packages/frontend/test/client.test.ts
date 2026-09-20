// @vitest-environment node
import { expect, test, vi, afterEach } from 'vitest';
import { createApi } from '../src/api';
afterEach(() => vi.unstubAllGlobals());
test('timeout and explicit cancellation preserve distinct machine error codes', async () => {
  vi.stubGlobal(
    'fetch',
    (_url: unknown, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (options.signal?.aborted) reject(options.signal.reason);
        options.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason),
          { once: true },
        );
      }),
  );
  const client = createApi('http://test', 10);
  await expect(client.items.list()).rejects.toMatchObject({ code: 'TIMEOUT' });
  const controller = new AbortController();
  controller.abort();
  await expect(client.items.list({}, controller.signal)).rejects.toMatchObject({
    code: 'CANCELLED',
  });
});
test('server error status, business code and request ID survive the client boundary', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: 'FORBIDDEN',
          message: 'Read only',
          timestamp: new Date().toISOString(),
          requestId: 'fixture-id',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  await expect(createApi().items.create('x')).rejects.toMatchObject({
    status: 403,
    code: 'FORBIDDEN',
    requestId: 'fixture-id',
  });
});
test('malformed success body is rejected by the shared response schema', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('{"items":"not an array"}', {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await expect(createApi().items.list()).rejects.toThrow();
});
