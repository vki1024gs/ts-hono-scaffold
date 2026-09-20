import { expect, test } from 'vitest';
import {
  contract,
  CreateItemBody,
  ItemListQuery,
  StatusResponse,
} from '../src';
test('contract uses a shared API prefix and rejects invalid payloads', () => {
  for (const route of Object.values(contract.items))
    expect(route.path).toMatch(/^\/api\//);
  expect(CreateItemBody.safeParse({ name: ' ' }).success).toBe(false);
  expect(
    CreateItemBody.safeParse({ name: 'valid', secret: 'extra' }).success,
  ).toBe(false);
  expect(ItemListQuery.safeParse({ page: '0' }).success).toBe(false);
  expect(ItemListQuery.parse({})).toMatchObject({
    page: 1,
    limit: 20,
    search: '',
  });
  expect(StatusResponse.safeParse({ status: 'ok' }).success).toBe(false);
  expect(
    contract.items.create.responses[201].safeParse({ name: 'missing fields' })
      .success,
  ).toBe(false);
});
