export const RENDERER_RESTART_LIMIT = 3;
export const RENDERER_RESTART_WINDOW_MS = 60_000;
export const RENDERER_PROBE_TIMEOUT_MS = 2_500;

/** Bounds automatic renderer restarts so a WebView that crashes on load cannot remount forever. */
export class RendererRestartBudget {
  private restarts: number[] = [];

  constructor(
    private readonly limit = RENDERER_RESTART_LIMIT,
    private readonly windowMs = RENDERER_RESTART_WINDOW_MS,
  ) {}

  tryRestart(now: number): boolean {
    this.restarts = this.restarts.filter((at) => now - at < this.windowMs);
    if (this.restarts.length >= this.limit) return false;
    this.restarts.push(now);
    return true;
  }

  reset(): void {
    this.restarts = [];
  }
}
