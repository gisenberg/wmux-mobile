import type { GestureResponderEvent, PanResponderGestureState } from "react-native";
import type { Point, ToHost } from "./bridge";
import {
  LONG_PRESS_DELAY_MS,
  MULTI_TAP_DELAY_MS,
  clampTerminalPoint,
  consumeScrollPixels,
  nextTapTracker,
  type ScrollAccumulator,
  type TapTracker,
  type TerminalCursor,
  type TerminalMetrics,
  type TerminalSelection,
} from "./interactions";

export interface TerminalInteractionLayerProps {
  active: boolean;
  altScreen: boolean;
  cursor?: TerminalCursor;
  height: number;
  metrics?: TerminalMetrics;
  mouseTracking: boolean;
  onActivateLink: (point: Point) => Promise<boolean>;
  onCopy: () => void;
  onCycleTab: (direction: -1 | 1) => void;
  onFocusInput: () => void;
  onSend: (message: ToHost) => void;
  paneId: string;
  selection: TerminalSelection;
  width: number;
}

interface TouchPoint extends Point {
  pageX: number;
  pageY: number;
}

export interface LoupeState extends Point {
  label: string;
}

interface InteractionConfig extends TerminalInteractionLayerProps {
  setLoupe: (state: LoupeState | undefined) => void;
}

interface AnimationClock {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
}

const pointFromEvent = (event: GestureResponderEvent): TouchPoint => ({
  pageX: event.nativeEvent.pageX,
  pageY: event.nativeEvent.pageY,
  x: event.nativeEvent.locationX,
  y: event.nativeEvent.locationY,
});

export class TerminalGestureController {
  private config: InteractionConfig;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPoint: TouchPoint | undefined;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private momentumFrame: ReturnType<typeof requestAnimationFrame> | undefined;
  private axis: "horizontal" | "vertical" | undefined;
  private touching = false;
  private scroll: ScrollAccumulator = { remainderPx: 0 };
  private selecting = false;
  private tapActionGeneration = 0;
  private tapTracker: TapTracker | undefined;

  constructor(
    config: InteractionConfig,
    private readonly clock: AnimationClock = {
      now: () => performance.now(),
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
  ) {
    this.config = config;
  }

  update(config: InteractionConfig): void {
    if (config.paneId !== this.config.paneId || !config.active) {
      this.terminate();
      this.tapTracker = undefined;
    }
    if (config.mouseTracking !== this.config.mouseTracking) this.stopMomentum();
    this.config = config;
  }

  grant(event: GestureResponderEvent): void {
    if (!this.config.active) return;
    this.cancelTapAction();
    this.stopMomentum();
    this.touching = true;
    this.axis = undefined;
    const point = pointFromEvent(event);
    this.lastPoint = point;
    this.scroll = { remainderPx: 0 };
    this.selecting = false;
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.selecting = true;
      this.sendSelection("start", point);
      this.sendSelection("move", {
        x: point.x + Math.max(1, this.config.metrics?.cellW ?? 8),
        y: point.y,
      });
      this.config.setLoupe({ x: point.x, y: point.y, label: "Selecting" });
    }, LONG_PRESS_DELAY_MS);
  }

  move(event: GestureResponderEvent, gesture: PanResponderGestureState): void {
    if (!this.touching) return;
    if (gesture.numberActiveTouches > 1) {
      this.terminate();
      return;
    }
    const point = pointFromEvent(event);
    const previous = this.lastPoint ?? point;
    this.lastPoint = point;
    if (this.selecting) {
      const local = clampTerminalPoint(point, this.config.width, this.config.height);
      this.sendSelection("move", local);
      this.config.setLoupe({
        ...local,
        label: this.config.selection.text?.trim().slice(0, 28) || "Selecting",
      });
      return;
    }
    this.lockAxis(gesture);
    if (this.axis !== "vertical") return;
    const result = consumeScrollPixels(this.scroll, -(point.pageY - previous.pageY), this.config.metrics?.cellH ?? 18);
    this.scroll = result.state;
    if (result.deltaLines) {
      this.sendScroll(result.deltaLines, point);
    }
  }

  release(event: GestureResponderEvent, gesture: PanResponderGestureState): void {
    if (!this.touching) return;
    this.touching = false;
    this.clearLongPress();
    const point = clampTerminalPoint(pointFromEvent(event), this.config.width, this.config.height);
    if (this.selecting) {
      this.sendSelection("end", point);
      this.selecting = false;
      this.config.setLoupe(undefined);
      return;
    }
    this.lockAxis(gesture);
    if (this.axis === "vertical") {
      this.startMomentum(gesture.vy);
      return;
    }
    if (
      this.axis === "horizontal" &&
      !this.config.altScreen &&
      !this.config.mouseTracking &&
      Math.abs(gesture.dx) >= 72
    ) {
      this.config.onCycleTab(gesture.dx < 0 ? 1 : -1);
      return;
    }
    if (!this.axis && Math.abs(gesture.dx) < 12 && Math.abs(gesture.dy) < 12) {
      this.handleTap(point, event.nativeEvent.timestamp);
    }
  }

  terminate(): void {
    this.touching = false;
    this.cancelTapAction();
    this.stopMomentum();
    this.clearLongPress();
    if (this.selecting && this.lastPoint) this.sendSelection("end", this.lastPoint);
    this.selecting = false;
    this.config.setLoupe(undefined);
  }

  dispose(): void {
    this.terminate();
  }

  private lockAxis(gesture: Pick<PanResponderGestureState, "dx" | "dy">): void {
    if (this.axis || Math.hypot(gesture.dx, gesture.dy) < 9) return;
    this.axis = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? "horizontal" : "vertical";
    this.clearLongPress();
    this.cancelTapAction();
    this.tapTracker = undefined;
  }

  private cancelTapAction(): void {
    this.tapActionGeneration += 1;
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
  }

  private clearLongPress(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = undefined;
  }

  private handleTap(point: Point, timeMs: number): void {
    const actionGeneration = ++this.tapActionGeneration;
    const tracker = nextTapTracker(this.tapTracker, point, timeMs);
    this.tapTracker = tracker;
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    if (tracker.count === 2) {
      this.sendSelection("word", point);
      this.config.setLoupe({ ...point, label: "Word selected" });
      return;
    }
    if (tracker.count === 3) {
      this.sendSelection("line", point);
      this.config.setLoupe({ ...point, label: "Line selected" });
      this.tapTracker = undefined;
      return;
    }
    this.focusTimer = setTimeout(() => {
      this.focusTimer = undefined;
      void this.config
        .onActivateLink(point)
        .then((activated) => {
          if (!activated && actionGeneration === this.tapActionGeneration) this.config.onFocusInput();
        })
        .catch(() => {
          if (actionGeneration === this.tapActionGeneration) this.config.onFocusInput();
        });
    }, MULTI_TAP_DELAY_MS);
  }

  private sendSelection(action: Extract<ToHost, { t: "selection" }>["action"], point?: Point): void {
    this.config.onSend({
      t: "selection",
      paneId: this.config.paneId,
      action,
      ...(point ? { xPx: point.x, yPx: point.y } : {}),
    });
  }

  private startMomentum(velocityY: number): void {
    this.stopMomentum();
    if (Math.abs(velocityY) < 0.18) return;
    let velocity = Math.max(-1.8, Math.min(1.8, velocityY));
    let previousTime = this.clock.now();
    const tick = (time: number): void => {
      const elapsed = Math.min(48, Math.max(0, time - previousTime));
      previousTime = time;
      const decay = Math.exp(-elapsed / 160);
      const deltaPx = velocity * 160 * (1 - decay);
      velocity *= decay;
      const result = consumeScrollPixels(this.scroll, -deltaPx, this.config.metrics?.cellH ?? 18);
      this.scroll = result.state;
      if (result.deltaLines) {
        this.sendScroll(result.deltaLines, this.lastPoint ?? { x: 0, y: 0 });
      }
      if (Math.abs(velocity) < 0.04) this.momentumFrame = undefined;
      else this.momentumFrame = this.clock.request(tick);
    };
    this.momentumFrame = this.clock.request(tick);
  }

  private stopMomentum(): void {
    if (this.momentumFrame !== undefined) this.clock.cancel(this.momentumFrame);
    this.momentumFrame = undefined;
  }

  private sendScroll(deltaLines: number, point: Point): void {
    const terminalPoint = clampTerminalPoint(point, this.config.width, this.config.height);
    this.config.onSend({
      t: "scroll",
      paneId: this.config.paneId,
      deltaLines,
      xPx: terminalPoint.x,
      yPx: terminalPoint.y,
    });
  }
}
