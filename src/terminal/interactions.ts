import type { Point, ToNative } from "@/terminal/bridge";

export interface TerminalMetrics {
  cellH: number;
  cellW: number;
  cols: number;
  rows: number;
}

export interface TerminalCursor {
  visible: boolean;
  xPx: number;
  yPx: number;
}

export type TerminalSelection = Omit<Extract<ToNative, { t: "selection" }>, "paneId" | "t">;

export interface TapTracker {
  count: 1 | 2 | 3;
  timeMs: number;
  x: number;
  y: number;
}

export interface ScrollAccumulator {
  remainderPx: number;
}

export type ScrollReleaseAction = "momentum" | "scrollToBottom";

export const LONG_PRESS_DELAY_MS = 440;
export const MULTI_TAP_DELAY_MS = 310;
export const TAP_DISTANCE_PX = 26;

export const nextTapTracker = (previous: TapTracker | undefined, point: Point, timeMs: number): TapTracker => {
  const continuesSequence =
    previous !== undefined &&
    timeMs - previous.timeMs <= MULTI_TAP_DELAY_MS &&
    Math.hypot(point.x - previous.x, point.y - previous.y) <= TAP_DISTANCE_PX;
  const count = continuesSequence ? (((previous.count % 3) + 1) as 1 | 2 | 3) : 1;
  return { count, timeMs, x: point.x, y: point.y };
};

export const consumeScrollPixels = (
  state: ScrollAccumulator,
  deltaPx: number,
  cellHeight: number,
): { deltaLines: number; state: ScrollAccumulator } => {
  const safeCellHeight = Math.max(1, cellHeight);
  const total = state.remainderPx + deltaPx;
  const deltaLines = total < 0 ? Math.ceil(total / safeCellHeight) : Math.floor(total / safeCellHeight);
  return {
    deltaLines,
    state: { remainderPx: total - deltaLines * safeCellHeight },
  };
};

export const scrollReleaseAction = (
  gesture: { dx: number; dy: number; vy: number },
  mouseTracking: boolean,
): ScrollReleaseAction =>
  !mouseTracking &&
  Math.abs(gesture.dy) > Math.abs(gesture.dx) &&
  Math.abs(gesture.dy) >= 12 &&
  gesture.dy < -84 &&
  gesture.vy < -0.45
    ? "scrollToBottom"
    : "momentum";

export const clampTerminalPoint = (point: Point, width: number, height: number): Point => ({
  x: Math.max(0, Math.min(point.x, Math.max(0, width))),
  y: Math.max(0, Math.min(point.y, Math.max(0, height))),
});

export const selectionAnchorPoint = (
  selection: TerminalSelection,
  metrics: TerminalMetrics,
  handle: "end" | "start",
): Point | undefined => {
  const point = handle === "start" ? selection.endPx : selection.startPx;
  if (!point) return undefined;
  return handle === "start"
    ? {
        x: Math.max(0, point.x - metrics.cellW / 2),
        y: Math.max(0, point.y - metrics.cellH / 2),
      }
    : {
        x: point.x + metrics.cellW / 2,
        y: point.y + metrics.cellH / 2,
      };
};

export const quoteStagedImagePath = (targetPath: string): string => {
  if (!targetPath || targetPath.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(targetPath)) {
    throw new Error("Invalid staged image path");
  }
  if (/^[A-Za-z]:[\\/]/.test(targetPath)) return `'${targetPath.replace(/'/g, "''")}'`;
  if (!targetPath.startsWith("/")) throw new Error("Staged image path is not absolute");
  return `'${targetPath.replace(/'/g, "'\\''")}'`;
};

export const base64FromDataUrl = (value: string): string => {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!match?.[1]) throw new Error("Clipboard image data is malformed");
  return match[1].replace(/\s+/g, "");
};
