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
  private latest: TerminalViewport | undefined;
  private inputFocused = false;
  private keyboardViewportLocked = false;
  private lockOnCommit = false;
  private keyboardHeight = 0;
  private committedWithKeyboard = false;

  constructor(
    private readonly commit: (viewport: TerminalViewport) => void,
    private readonly scheduleFrame: ScheduleFrame = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {}

  update(viewport: TerminalViewport): void {
    if (this.disposed) return;
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    )
      return;
    if (this.committed && Math.abs(viewport.width - this.committed.width) < 1) {
      viewport = { ...viewport, width: this.committed.width };
    }
    this.latest = viewport;
    if (this.committed && viewport.width !== this.committed.width) {
      this.keyboardViewportLocked = false;
      this.lockOnCommit = this.inputFocused;
    }
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

  setInputFocused(focused: boolean): void {
    this.inputFocused = focused;
    if (focused) {
      if (this.keyboardHeight > 0) {
        if (this.committedWithKeyboard) this.keyboardViewportLocked = true;
        this.lockOnCommit = true;
        if (!this.transitionActive) this.scheduleSettledFlush();
      }
      return;
    }
    this.keyboardViewportLocked = false;
    this.lockOnCommit = false;
    if (this.latest) this.update(this.latest);
  }

  beginTransition(): void {
    if (this.disposed) return;
    this.transitionActive = true;
    this.cancelSettlingFrame();
  }

  endTransition(keyboardHeight = 0): void {
    if (this.disposed) return;
    this.transitionActive = false;
    this.keyboardHeight = keyboardHeight;
    if (this.inputFocused && keyboardHeight > 0) this.lockOnCommit = true;
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
    if (this.keyboardViewportLocked && viewport?.width === this.committed?.width) {
      this.pending = undefined;
      return;
    }
    if (this.lockOnCommit) {
      this.keyboardViewportLocked = true;
      this.lockOnCommit = false;
    }
    this.pending = undefined;
    if (sameViewport(viewport, this.committed)) return;
    this.committed = viewport;
    this.committedWithKeyboard = this.keyboardHeight > 0;
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
