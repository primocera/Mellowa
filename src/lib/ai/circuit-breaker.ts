/**
 * Simple consecutive-failure circuit breaker (Launch v6, Prompt 14).
 *
 * Pure and instance-local: on serverless each warm instance keeps its own
 * breaker, which is best-effort by design — it prevents a warm instance from
 * hammering a failing provider (request storms), while cold instances still
 * probe so recovery is automatic. The hard global stop remains the daily cost
 * ceiling in claim_ai_generation.
 */

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens. */
  threshold: number;
  /** How long the circuit stays open before probing again (ms). */
  openMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedUntil = 0;
  private readonly now: () => number;

  constructor(private readonly opts: BreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** True while the circuit is open — callers must not hit the provider. */
  isOpen(): boolean {
    return this.now() < this.openedUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedUntil = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.opts.threshold) {
      this.openedUntil = this.now() + this.opts.openMs;
      // Half-open: after openMs one probe is allowed; a failure re-opens.
      this.failures = this.opts.threshold - 1;
    }
  }
}
