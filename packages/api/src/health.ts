import { z } from 'zod';
export const HealthState = z.enum([
  'healthy',
  'degraded',
  'starting',
  'unhealthy',
  'stopping',
]);
export const CheckResult = z.object({
  name: z.string(),
  required: z.boolean(),
  status: z.enum(['pass', 'warn', 'fail', 'skipped']),
  code: z.string(),
  message: z.string(),
  checkedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  ageMs: z.number().nonnegative(),
});
export const ProbeResponse = z.object({
  schemaVersion: z.literal(1),
  status: HealthState,
  timestamp: z.string().datetime(),
  requestId: z.string(),
});
export const StatusResponse = ProbeResponse.extend({
  service: z.string(),
  version: z.string(),
  revision: z.string(),
  builtAt: z.string(),
  instanceId: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  uptime: z.number().nonnegative(),
  checks: z.array(CheckResult),
  storage: z.object({
    kind: z.enum(['memory', 'sqlite']),
    persistent: z.boolean(),
    schemaVersion: z.number().int().nullable(),
    schemaCompatibility: z.enum([
      'compatible',
      'incompatible',
      'not_applicable',
      'unknown',
    ]),
  }),
  databaseSchema: z.number().int().nullable(),
});
export type HealthStatus = z.infer<typeof StatusResponse>;
export type HealthCheck = z.infer<typeof CheckResult>;
