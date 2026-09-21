// Initialization replaces the package scope before dependencies exist.
// prettier-ignore
import { contract, initClient, tsRestFetchApi, ErrorResponse } from '@proj/api';
// Keep generated scopes formatting-stable.
// prettier-ignore
import type { ApiFetcherArgs, ClientInferRequest } from '@proj/api';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function createApi(baseUrl = '', timeoutMs = 15000) {
  const client = initClient(contract, {
    baseUrl,
    validateResponse: true,
    throwOnUnknownStatus: true,
    api: async (args: ApiFetcherArgs) => {
      const controller = new AbortController();
      const parent = args.fetchOptions?.signal;
      const abort = () => controller.abort(parent?.reason);
      if (parent?.aborted) abort();
      else parent?.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        return await tsRestFetchApi({
          ...args,
          fetchOptions: { ...args.fetchOptions, signal: controller.signal },
        });
      } catch (error) {
        if (timedOut) throw new ApiError(0, 'TIMEOUT', 'Request timed out');
        if (parent?.aborted)
          throw new ApiError(0, 'CANCELLED', 'Request cancelled');
        throw error;
      } finally {
        clearTimeout(timer);
        parent?.removeEventListener('abort', abort);
      }
    },
  });
  function unwrap<
    T extends { status: number; body: unknown; headers: Headers },
  >(result: T): Exclude<T['body'], { error: string }> {
    if (result.status >= 400) {
      const parsed = ErrorResponse.safeParse(result.body);
      throw new ApiError(
        result.status,
        parsed.success ? parsed.data.error : 'HTTP_ERROR',
        parsed.success ? parsed.data.message : 'Request failed',
        parsed.success
          ? parsed.data.requestId
          : result.headers.get('X-Request-Id') || undefined,
      );
    }
    return result.body as Exclude<T['body'], { error: string }>;
  }
  return {
    client,
    items: {
      list: async (
        query: ClientInferRequest<typeof contract.items.list>['query'] = {},
        signal?: AbortSignal,
      ) => unwrap(await client.items.list({ query, fetchOptions: { signal } })),
      create: async (name: string, signal?: AbortSignal) =>
        unwrap(
          await client.items.create({
            body: { name },
            fetchOptions: { signal },
          }),
        ),
      update: async (id: string, name: string, signal?: AbortSignal) =>
        unwrap(
          await client.items.update({
            params: { id },
            body: { name },
            fetchOptions: { signal },
          }),
        ),
      delete: async (id: string, signal?: AbortSignal) =>
        unwrap(
          await client.items.delete({
            params: { id },
            fetchOptions: { signal },
          }),
        ),
    },
  };
}
export const api = createApi();
export function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message +
        (error.requestId ? ' · Request ID: ' + error.requestId : '')
    : error instanceof Error
      ? error.message
      : 'Request failed';
}
