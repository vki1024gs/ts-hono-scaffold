import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@proj/api';
import { api, errorMessage } from '../api';
export function HomePage() {
  const [items, setItems] = useState<Item[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [editing, setEditing] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    locked = useRef(false),
    mounted = useRef(true);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const data = await api.items.list({ limit: 100 }, controller.signal);
      if (!controller.signal.aborted) setItems(data.items);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [load]);
  async function mutate(action: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (!mounted.current) return;
      setName('');
      setEditing(null);
      await load();
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section aria-labelledby="items-heading">
      <p className="eyebrow">YOUR APPLICATION</p>
      <h1 id="items-heading">Items</h1>
      <p className="muted">
        A small, complete starting point. Data is stored in memory and resets
        when the API restarts.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(() =>
            editing ? api.items.update(editing, name) : api.items.create(name),
          );
        }}
      >
        <label htmlFor="item-name">{editing ? 'Edit item' : 'New item'}</label>
        <div className="actions">
          <input
            id="item-name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <button disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setName('');
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => void load()} disabled={busy}>
            Retry loading
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading items…</p>
      ) : items.length === 0 ? (
        <p className="empty">No items yet. Add your first item above.</p>
      ) : (
        <ul className="items">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(item.id);
                    setName(item.name);
                    document.getElementById('item-name')?.focus();
                  }}
                  aria-label={'Edit ' + item.name}
                >
                  Edit
                </button>
                <button
                  disabled={busy}
                  onClick={() => void mutate(() => api.items.delete(item.id))}
                  aria-label={'Delete ' + item.name}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
