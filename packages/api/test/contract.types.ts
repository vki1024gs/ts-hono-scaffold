import type { ServerInferResponses } from '@ts-rest/core';
import type { contract } from '../src/contract';
// This compile-only assertion must stop compiling if the contract ceases to constrain response fields.
type Created = Extract<ServerInferResponses<typeof contract.items.create>, {status:201}>;
const invalid: Created = {
  status:201,
  body: {id:'fixture',name:'fixture',
    // @ts-expect-error The declared timestamp is a string, never a number.
    createdAt:123,
  },
};
void invalid;
