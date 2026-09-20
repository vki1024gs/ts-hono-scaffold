import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { ProbeResponse, StatusResponse } from './health';
const c = initContract();
export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
  requestId: z.string(),
});
const errors = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  500: ErrorResponse,
  503: ErrorResponse,
};
export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
});
export const CreateItemBody = z
  .object({ name: z.string().trim().min(1).max(200) })
  .strict();
export const UpdateItemBody = CreateItemBody;
export const IdPathParams = z.object({ id: z.string().min(1).max(100) });
export const ItemListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().max(200).default(''),
  sort: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export const ItemList = z.object({
  items: z.array(ItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});
export const itemsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/api/items',
      query: ItemListQuery,
      responses: { 200: ItemList, ...errors },
    },
    create: {
      method: 'POST',
      path: '/api/items',
      body: CreateItemBody,
      responses: { 201: ItemSchema, ...errors },
    },
    update: {
      method: 'PUT',
      path: '/api/items/:id',
      pathParams: IdPathParams,
      body: UpdateItemBody,
      responses: { 200: ItemSchema, ...errors },
    },
    delete: {
      method: 'DELETE',
      path: '/api/items/:id',
      pathParams: IdPathParams,
      body: c.noBody(),
      responses: { 200: z.object({ status: z.literal('deleted') }), ...errors },
    },
  },
  { strictStatusCodes: true },
);
export const statusContract = c.router(
  {
    check: {
      method: 'GET',
      path: '/status',
      responses: { 200: StatusResponse, 503: StatusResponse },
    },
  },
  { strictStatusCodes: true },
);
export const contract = c.router(
  {
    items: itemsContract,
    status: statusContract,
    health: {
      live: {
        method: 'GET',
        path: '/health/live',
        responses: { 200: ProbeResponse, 503: ProbeResponse },
      },
      ready: {
        method: 'GET',
        path: '/health/ready',
        responses: { 200: ProbeResponse, 503: ProbeResponse },
      },
    },
  },
  { strictStatusCodes: true },
);
export type Item = z.infer<typeof ItemSchema>;
export type AppContract = typeof contract;
