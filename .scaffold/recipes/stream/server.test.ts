import { expect, test } from 'vitest';
import { createApp } from '../src/app';
import { registerChat } from '../src/chat';
test('two sends persist two user messages and two replies with accurate SSE headers', async () => {
  const logger = { log: () => {}, status: () => ({ ok: true }) };
  const runtime = createApp({ logger }),
    chat = registerChat(runtime.app, logger),
    id = crypto.randomUUID();
  for (let i = 0; i < 2; i++) {
    const r = await runtime.app.request('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: id, content: 'Hello' }),
    });
    expect(r.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await r.text()).toContain('event: done');
  }
  expect(chat.messages(id).map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
  ]);
});
