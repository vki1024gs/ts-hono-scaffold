import { chatContract, ChatEvent } from '@proj/api';
import type { ChatEventValue } from '@proj/api';
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEventValue) => void,
  signal?: AbortSignal,
) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = '',
    done = false;
  const abort = () => void reader.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  const accept = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const event = ChatEvent.parse(JSON.parse(data));
    if (done) throw new Error('Event after completion');
    if (event.type === 'error')
      throw new Error(event.message + ' · Request ID: ' + event.requestId);
    onEvent(event);
    if (event.type === 'done') done = true;
  };
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const result = await reader.read();
      if (result.done) {
        pending += decoder.decode();
        break;
      }
      pending += decoder.decode(result.value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        accept(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (pending.length > 65536) throw new Error('SSE frame too large');
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!done) throw new Error('Stream ended before done');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function streamReply(
  conversationId: string,
  content: string,
  onEvent: (event: ChatEventValue) => void,
  signal: AbortSignal,
) {
  const response = await fetch(chatContract.send.path, {
    method: chatContract.send.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, content }),
    signal,
  });
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('text/event-stream') ||
    !response.body
  )
    throw new Error(
      'Unable to start reply · Request ID: ' +
        (response.headers.get('X-Request-Id') || 'unknown'),
    );
  await readEvents(response.body, onEvent, signal);
}
