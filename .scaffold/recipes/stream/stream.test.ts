// @vitest-environment node
import { expect, test } from 'vitest';
import { readEvents } from '../src/api/chat';
const encode = (value: string) => new TextEncoder().encode(value);
const body = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encode(chunk));
      controller.close();
    },
  });
test('parser handles split CRLF, multiline data and done', async () => {
  const events: unknown[] = [];
  await readEvents(
    body([
      'event: start\r',
      '\ndata: {"type":"start",\r\ndata: "requestId":"id"}\r\n\r',
      '\ndata: {"type":"done","message":{"id":"one","role":"assistant","content":"yes"}}\r\n\r\n',
    ]),
    (e) => events.push(e),
  );
  expect(events).toHaveLength(2);
});
test('EOF, invalid JSON, explicit errors and cancellation reject and release readers', async () => {
  for (const text of [
    'data: {"type":"start","requestId":"id"}\n\n',
    'data: invalid\n\n',
    'data: {"type":"error","code":"FAIL","message":"Failed","requestId":"id"}\n\n',
  ]) {
    const stream = body([text]);
    await expect(readEvents(stream, () => {})).rejects.toThrow();
    expect(stream.locked).toBe(false);
  }
  const controller = new AbortController();
  controller.abort();
  await expect(
    readEvents(body([]), () => {}, controller.signal),
  ).rejects.toThrow();
});
