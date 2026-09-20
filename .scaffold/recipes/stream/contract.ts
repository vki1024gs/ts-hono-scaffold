import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { ErrorResponse } from './contract';
const c = initContract();
export const ChatInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
});
export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), requestId: z.string() }),
  z.object({ type: z.literal('token'), token: z.string() }),
  z.object({ type: z.literal('done'), message: ChatMessage }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
]);
export const chatContract = c.router({
  send: {
    method: 'POST',
    path: '/api/chat/stream',
    body: ChatInput,
    responses: {
      200: c.otherResponse({
        contentType: 'text/event-stream',
        body: z.string(),
      }),
      400: ErrorResponse,
      500: ErrorResponse,
    },
  },
});
export type ChatEventValue = z.infer<typeof ChatEvent>;
