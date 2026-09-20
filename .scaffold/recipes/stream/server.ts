import { streamSSE } from 'hono/streaming';
import type { Hono } from 'hono';
import { chatContract, ChatInput } from '@proj/api';
import type { ChatEventValue } from '@proj/api';
import type { Logger } from '../../../scripts/lib/logging.mjs';
import type { AppEnv } from './app';
import { parseRequest, requestJson } from './app';
export function registerChat(app: Hono<AppEnv>, logger: Logger) {
  const conversations = new Map<
    string,
    { id: string; role: 'user' | 'assistant'; content: string }[]
  >();
  app.post(chatContract.send.path, async (c) => {
    const input = parseRequest(ChatInput, await requestJson(c)),
      requestId = c.get('requestId');
    const messages = conversations.get(input.conversationId) ?? [];
    conversations.set(input.conversationId, messages);
    messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: input.content,
    }); // Sole user-message write.
    c.set('streaming', true);
    const started = performance.now();
    return streamSSE(c, async (stream) => {
      let cancelled = false,
        outcome = 'completed';
      stream.onAbort(() => {
        cancelled = true;
      });
      const emit = (event: ChatEventValue) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      try {
        await emit({ type: 'start', requestId });
        let content = '';
        for (const token of ['This ', 'is ', 'a ', 'streamed ', 'reply.']) {
          if (cancelled) {
            outcome = 'cancelled';
            return;
          }
          content += token;
          await emit({ type: 'token', token });
          await stream.sleep(30);
        }
        if (cancelled) {
          outcome = 'cancelled';
          return;
        }
        const message = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content,
        };
        messages.push(message);
        await emit({ type: 'done', message });
      } catch {
        outcome = cancelled ? 'cancelled' : 'failed';
        if (!cancelled)
          await emit({
            type: 'error',
            code: 'STREAM_FAILED',
            message: 'Reply interrupted',
            requestId,
          }).catch(() => {});
      } finally {
        logger.log(outcome === 'failed' ? 'error' : 'info', 'http.completed', {
          requestId,
          method: 'POST',
          route: chatContract.send.path,
          statusCode: 200,
          durationMs: performance.now() - started,
          outcome,
        });
      }
    });
  });
  return { messages: (id: string) => [...(conversations.get(id) ?? [])] };
}
