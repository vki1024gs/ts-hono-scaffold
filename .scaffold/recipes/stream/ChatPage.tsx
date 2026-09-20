import { useEffect, useRef, useState } from 'react';
import { streamReply } from '../api/chat';
export function ChatPage() {
  const [messages, setMessages] = useState<
      { id: string; role: string; content: string }[]
    >([]),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const conversation = useRef(crypto.randomUUID()),
    request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function send() {
    if (request.current || !content.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    const text = content,
      id = crypto.randomUUID();
    setContent('');
    setMessages((old) => [
      ...old,
      { id: crypto.randomUUID(), role: 'user', content: text },
      { id, role: 'assistant', content: '' },
    ]);
    try {
      await streamReply(
        conversation.current,
        text,
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'token')
            setMessages((old) =>
              old.map((m) =>
                m.id === id ? { ...m, content: m.content + event.token } : m,
              ),
            );
          if (event.type === 'done')
            setMessages((old) =>
              old.map((m) => (m.id === id ? event.message : m)),
            );
        },
        controller.signal,
      );
    } catch (e) {
      setError(
        controller.signal.aborted
          ? 'Reply cancelled'
          : e instanceof Error
            ? e.message
            : 'Reply failed',
      );
    } finally {
      request.current = null;
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>Chat example</h1>
      <p>Local memory only. Restarting clears server messages.</p>
      <ol>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.role}</strong>: {m.content}
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="message">Message</label>
        <input
          id="message"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={busy}
          maxLength={4000}
        />
        <button disabled={busy || !content.trim()}>Send</button>
        {busy && (
          <button type="button" onClick={() => request.current?.abort()}>
            Cancel
          </button>
        )}
      </form>
    </section>
  );
}
