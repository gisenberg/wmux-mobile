export interface TerminalViewport {
  width: number;
  height: number;
}

type FrameHandle = ReturnType<typeof requestAnimationFrame>;
type ScheduleFrame = (callback: FrameRequestCallback) => FrameHandle;
type CancelFrame = (handle: FrameHandle) => void;

export class TerminalViewportCoordinator {
  private pending: TerminalViewport | undefined;
  private committed: TerminalViewport | undefined;
  private settlingFrame: FrameHandle | undefined;
  private transitionActive = false;
  private disposed = false;

  constructor(
    private readonly commit: (viewport: TerminalViewport) => void,
    private readonly scheduleFrame: ScheduleFrame = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {}

  update(viewport: TerminalViewport): void {
    if (this.disposed) return;
    if (sameViewport(viewport, this.committed)) {
      this.pending = undefined;
      if (!this.transitionActive) this.cancelSettlingFrame();
      return;
    }
    this.pending = viewport;
    if (this.committed === undefined && !this.transitionActive) {
      this.flush();
      return;
    }
    if (!this.transitionActive) this.scheduleSettledFlush();
  }

  activate(): void {
    this.disposed = false;
  }

  beginTransition(): void {
    if (this.disposed) return;
    this.transitionActive = true;
    this.cancelSettlingFrame();
  }

  endTransition(): void {
    if (this.disposed) return;
    this.transitionActive = false;
    this.scheduleSettledFlush();
  }

  private scheduleSettledFlush(): void {
    this.cancelSettlingFrame();
    this.settlingFrame = this.scheduleFrame(() => {
      this.settlingFrame = this.scheduleFrame(() => {
        this.settlingFrame = undefined;
        if (!this.transitionActive) this.flush();
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelSettlingFrame();
    this.transitionActive = false;
    this.pending = undefined;
  }

  private flush(): void {
    const viewport = this.pending;
    if (!viewport) return;
    this.pending = undefined;
    if (sameViewport(viewport, this.committed)) return;
    this.committed = viewport;
    this.commit(viewport);
  }

  private cancelSettlingFrame(): void {
    if (this.settlingFrame === undefined) return;
    this.cancelFrame(this.settlingFrame);
    this.settlingFrame = undefined;
  }
}

const sameViewport = (first: TerminalViewport, second: TerminalViewport | undefined): boolean =>
  second !== undefined && first.width === second.width && first.height === second.height;
