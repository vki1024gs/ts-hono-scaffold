import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { App } from '../src/App';
import { api, ApiError } from '../src/api';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
const empty = { items: [], total: 0, page: 1, limit: 100, hasMore: false };
test('load failure offers retry and then shows the empty state', async () => {
  vi.spyOn(api.items, 'list')
    .mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL_ERROR', 'Failed', 'test-id'),
    )
    .mockResolvedValue(empty);
  render(<HomePage />);
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect((await screen.findByRole('alert')).textContent).toContain('test-id');
  fireEvent.click(screen.getByText('Retry loading'));
  await screen.findByText(/No items yet/);
});
test('write failure preserves input and permits a successful second submission', async () => {
  vi.spyOn(api.items, 'list').mockResolvedValue(empty);
  const create = vi
    .spyOn(api.items, 'create')
    .mockRejectedValueOnce(new Error('Write failed'))
    .mockResolvedValue({
      id: 'one',
      name: 'Alpha',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  render(<HomePage />);
  await screen.findByText(/No items yet/);
  fireEvent.change(screen.getByLabelText('New item'), {
    target: { value: 'Alpha' },
  });
  fireEvent.click(screen.getByText('Add item'));
  await screen.findByText('Write failed');
  expect((screen.getByLabelText('New item') as HTMLInputElement).value).toBe(
    'Alpha',
  );
  fireEvent.click(screen.getByText('Add item'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect((screen.getByLabelText('New item') as HTMLInputElement).value).toBe(
      '',
    ),
  );
});
test('unknown page has a recovery link', () => {
  window.history.replaceState(null, '', '/missing');
  render(<App />);
  expect(screen.getByRole('heading').textContent).toBe('Page not found');
  expect(screen.getByText('Return home').getAttribute('href')).toBe('/');
});
