import type { HealthCheck, HealthStatus } from '@proj/api';
import type { Logger } from '../../../scripts/lib/logging.mjs';
export type Check = {
  name: string;
  required: boolean;
  run: (signal: AbortSignal) => Promise<void>;
};
export class Health {
  phase: 'starting' | 'running' | 'stopping' = 'starting';
  private cache: HealthCheck[] = [];
  private cachedAt = -Infinity;
  private pending = new Map<string, Promise<void>>();
  private round?: Promise<HealthCheck[]>;
  private previous = '';
  private previousState: HealthStatus['status'] = 'starting';
  private lastReport = 0;
  private suppressed = 0;
  constructor(
    private checks: Check[],
    private logger: Logger,
    private options = {
      timeoutMs: 500,
      cacheMs: 1000,
      now: () => performance.now(),
    },
  ) {}
  start() {
    this.phase = 'running';
    this.cachedAt = -Infinity;
  }
  stop() {
    this.phase = 'stopping';
  }
  private async check(def: Check): Promise<HealthCheck> {
    const start = this.options.now(),
      controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let status: HealthCheck['status'] = 'pass',
      code = 'PASS';
    try {
      if (this.pending.has(def.name))
        throw Object.assign(new Error(), { code: 'CHECK_TIMEOUT' });
      const task = Promise.resolve().then(() => def.run(controller.signal));
      this.pending.set(def.name, task);
      void task.finally(() => this.pending.delete(def.name)).catch(() => {});
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error(), { code: 'CHECK_TIMEOUT' }));
          }, this.options.timeoutMs);
        }),
      ]);
    } catch (error) {
      status = def.required ? 'fail' : 'warn';
      code =
        (error as { code?: string }).code === 'CHECK_TIMEOUT'
          ? 'CHECK_TIMEOUT'
          : 'CHECK_FAILED';
    } finally {
      clearTimeout(timer);
    }
    return {
      name: def.name,
      required: def.required,
      status,
      code,
      message:
        code === 'PASS'
          ? 'Check passed'
          : code === 'CHECK_TIMEOUT'
            ? 'Check exceeded deadline'
            : 'Check failed; inspect diagnostic logs',
      checkedAt: new Date().toISOString(),
      durationMs: Math.max(0, this.options.now() - start),
      ageMs: 0,
    };
  }
  async snapshot(): Promise<{
    status: HealthStatus['status'];
    checks: HealthCheck[];
  }> {
    if (this.options.now() - this.cachedAt >= this.options.cacheMs) {
      this.round ??= Promise.all(this.checks.map((check) => this.check(check)))
        .then((values) => {
          this.cache = values;
          this.cachedAt = this.options.now();
          return values;
        })
        .finally(() => {
          this.round = undefined;
        });
      await this.round;
    }
    const checks = this.cache.map((check) => ({
      ...check,
      ageMs: Math.max(0, this.options.now() - this.cachedAt),
    }));
    const status =
      this.phase === 'stopping'
        ? 'stopping'
        : this.phase === 'starting'
          ? 'starting'
          : checks.some((c) => c.required && c.status !== 'pass')
            ? 'unhealthy'
            : checks.some((c) => c.status === 'warn' || c.status === 'fail')
              ? 'degraded'
              : 'healthy';
    const signature = JSON.stringify([
      status,
      checks.map((c) => [c.name, c.code]),
    ]);
    if (signature !== this.previous) {
      this.logger.log(
        status === 'healthy' ? 'info' : 'warn',
        'health.changed',
        {
          status,
          previous: this.previousState,
          code: checks.find((c) => c.status === 'fail' || c.status === 'warn')
            ?.code,
          checkName: checks.find(
            (c) => c.status === 'fail' || c.status === 'warn',
          )?.name,
        },
      );
      this.previousState = status;
      this.previous = signature;
      this.lastReport = this.options.now();
      this.suppressed = 0;
    } else if (status !== 'healthy') {
      this.suppressed++;
      if (this.options.now() - this.lastReport >= 60000) {
        this.logger.log('warn', 'health.summary', {
          status,
          suppressedCount: this.suppressed,
        });
        this.lastReport = this.options.now();
        this.suppressed = 0;
      }
    }
    return { status, checks };
  }
}
