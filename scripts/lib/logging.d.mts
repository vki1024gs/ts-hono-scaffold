export type Identity = {
  service: string;
  component?: string;
  instanceId: string;
  version: string;
  revision: string;
  attemptId?: string;
};
export type Logger = {
  log: (level: string, event: string, fields?: Record<string, unknown>) => void;
  status: () => { ok: boolean };
};
export function createLogger(
  identity: Identity,
  options?: {
    level?: string;
    write?: (line: string) => unknown;
    fallback?: () => unknown;
  },
): Logger;
