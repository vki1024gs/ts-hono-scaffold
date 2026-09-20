import { expect, test } from 'vitest';
import { createMemoryItems } from '../src';
test('repository CRUD is isolated per instance and does not expose mutable records', async () => {
  const repo = createMemoryItems({
    id: () => 'one',
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const item = await repo.create('first');
  item.name = 'mutated';
  expect((await repo.list())[0].name).toBe('first');
  expect(await repo.update('one', 'second')).toMatchObject({ name: 'second' });
  expect(await repo.update('missing', 'x')).toBeNull();
  expect(await createMemoryItems().list()).toEqual([]);
  expect(await repo.delete('one')).toBe(true);
  expect(await repo.delete('one')).toBe(false);
});
