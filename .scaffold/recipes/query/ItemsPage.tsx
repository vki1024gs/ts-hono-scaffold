import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../api';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
      retry: (failures, error) =>
        failures < 1 &&
        (!(error instanceof ApiError) ||
          error.status === 0 ||
          error.status >= 500),
    },
    mutations: { retry: false },
  },
});
function Items() {
  const cache = useQueryClient(),
    [name, setName] = useState('');
  const query = useQuery({
    queryKey: ['items'],
    queryFn: ({ signal }) => api.items.list({}, signal),
  });
  const create = useMutation({
    mutationFn: () => api.items.create(name),
    onSuccess: async () => {
      setName('');
      await cache.invalidateQueries({ queryKey: ['items'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.items.delete(id),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['items'] }),
  });
  const edit = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.items.update(id, value),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['items'] }),
  });
  const error = query.error || create.error || remove.error || edit.error;
  return (
    <section>
      <h1>Items with query caching</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label htmlFor="query-name">New item</label>
        <input
          id="query-name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={create.isPending || !name.trim()}>Add item</button>
      </form>
      {error && (
        <p role="alert">
          {errorMessage(error)}{' '}
          <button onClick={() => void query.refetch()}>Retry loading</button>
        </p>
      )}
      {query.isPending ? (
        <p role="status">Loading items…</p>
      ) : (
        <ul className="items">
          {query.data?.items.map((item) => (
            <li key={item.id}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get('name');
                  if (typeof value === 'string')
                    edit.mutate({ id: item.id, value });
                }}
              >
                <input
                  aria-label={'Edit ' + item.name}
                  name="name"
                  defaultValue={item.name}
                  required
                  maxLength={200}
                />
                <button disabled={edit.isPending}>Save</button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {query.data?.total === 0 && <p>No items yet.</p>}
    </section>
  );
}
export function HomePage() {
  return (
    <QueryClientProvider client={queryClient}>
      <Items />
    </QueryClientProvider>
  );
}
