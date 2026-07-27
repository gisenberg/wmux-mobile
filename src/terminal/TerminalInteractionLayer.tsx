import { useEffect, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";

import type { Point, ToHost } from "@/terminal/bridge";
import {
  LONG_PRESS_DELAY_MS,
  MULTI_TAP_DELAY_MS,
  clampTerminalPoint,
  consumeScrollPixels,
  nextTapTracker,
  selectionAnchorPoint,
  type ScrollAccumulator,
  type TapTracker,
  type TerminalCursor,
  type TerminalMetrics,
  type TerminalSelection,
} from "@/terminal/interactions";
import { colors, fonts } from "@/ui/theme";

interface TerminalInteractionLayerProps {
  altScreen: boolean;
  cursor?: TerminalCursor;
  height: number;
  metrics?: TerminalMetrics;
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

interface LoupeState extends Point {
  label: string;
}

interface InteractionConfig extends TerminalInteractionLayerProps {
  setLoupe: (state: LoupeState | undefined) => void;
}

const pointFromEvent = (event: GestureResponderEvent): TouchPoint => ({
  pageX: event.nativeEvent.pageX,
  pageY: event.nativeEvent.pageY,
  x: event.nativeEvent.locationX,
  y: event.nativeEvent.locationY,
});

class TerminalGestureController {
  private config: InteractionConfig;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPoint: TouchPoint | undefined;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private momentumTimer: ReturnType<typeof setInterval> | undefined;
  private scroll: ScrollAccumulator = { remainderPx: 0 };
  private selecting = false;
  private tapActionGeneration = 0;
  private tapTracker: TapTracker | undefined;

  constructor(config: InteractionConfig) {
    this.config = config;
  }

  update(config: InteractionConfig): void {
    this.config = config;
  }

  grant(event: GestureResponderEvent): void {
    this.stopMomentum();
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
    if (Math.hypot(gesture.dx, gesture.dy) > 9) this.clearLongPress();
    if (Math.abs(gesture.dy) <= Math.abs(gesture.dx) || Math.abs(gesture.dy) < 6) return;
    const result = consumeScrollPixels(this.scroll, -(point.y - previous.y), this.config.metrics?.cellH ?? 18);
    this.scroll = result.state;
    if (result.deltaLines) {
      this.config.onSend({ t: "scroll", paneId: this.config.paneId, deltaLines: result.deltaLines });
    }
  }

  release(event: GestureResponderEvent, gesture: PanResponderGestureState): void {
    this.clearLongPress();
    const point = clampTerminalPoint(pointFromEvent(event), this.config.width, this.config.height);
    if (this.selecting) {
      this.sendSelection("end", point);
      this.selecting = false;
      this.config.setLoupe(undefined);
      return;
    }
    if (Math.abs(gesture.dy) > Math.abs(gesture.dx) && Math.abs(gesture.dy) >= 12) {
      if (gesture.dy < -84 && gesture.vy < -0.45) {
        this.config.onSend({ t: "scrollToBottom", paneId: this.config.paneId });
      } else {
        this.startMomentum(gesture.vy);
      }
      return;
    }
    if (!this.config.altScreen && Math.abs(gesture.dx) >= 72) {
      this.config.onCycleTab(gesture.dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(gesture.dx) < 12 && Math.abs(gesture.dy) < 12) {
      this.handleTap(point, event.nativeEvent.timestamp);
    }
  }

  terminate(): void {
    this.tapActionGeneration += 1;
    this.clearLongPress();
    if (this.selecting && this.lastPoint) this.sendSelection("end", this.lastPoint);
    this.selecting = false;
    this.config.setLoupe(undefined);
  }

  dispose(): void {
    this.tapActionGeneration += 1;
    this.clearLongPress();
    this.stopMomentum();
    if (this.focusTimer) clearTimeout(this.focusTimer);
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
    let velocityPx = Math.max(-30, Math.min(30, velocityY * 18));
    this.momentumTimer = setInterval(() => {
      velocityPx *= 0.9;
      const result = consumeScrollPixels(this.scroll, -velocityPx, this.config.metrics?.cellH ?? 18);
      this.scroll = result.state;
      if (result.deltaLines) {
        this.config.onSend({ t: "scroll", paneId: this.config.paneId, deltaLines: result.deltaLines });
      }
      if (Math.abs(velocityPx) < 0.7) this.stopMomentum();
    }, 16);
  }

  private stopMomentum(): void {
    if (this.momentumTimer) clearInterval(this.momentumTimer);
    this.momentumTimer = undefined;
  }
}

export function TerminalInteractionLayer(props: TerminalInteractionLayerProps) {
  const [loupe, setLoupe] = useState<LoupeState>();
  const [controller] = useState(() => new TerminalGestureController({ ...props, setLoupe }));
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (event) => controller.grant(event),
      onPanResponderMove: (event, gesture) => controller.move(event, gesture),
      onPanResponderRelease: (event, gesture) => controller.release(event, gesture),
      onPanResponderTerminate: () => controller.terminate(),
      onPanResponderTerminationRequest: () => false,
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
    }),
  );

  useEffect(() => {
    controller.update({ ...props, setLoupe });
  }, [controller, props]);

  useEffect(() => () => controller.dispose(), [controller]);

  const selectionLabel = props.selection.text?.trim().replace(/\s+/g, " ").slice(0, 28);
  const fallbackLoupePoint = props.cursor?.visible ? { x: props.cursor.xPx, y: props.cursor.yPx } : undefined;
  const displayedLoupe =
    loupe ?? (props.selection.active && fallbackLoupePoint ? { ...fallbackLoupePoint, label: "" } : undefined);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        accessibilityLabel="Terminal touch surface"
        accessibilityRole="adjustable"
        style={styles.touchSurface}
        {...responder.panHandlers}
      />
      {props.selection.active && props.selection.startPx && props.selection.endPx && props.metrics ? (
        <>
          <SelectionHandle
            height={props.height}
            kind="start"
            metrics={props.metrics}
            onLoupe={setLoupe}
            onSend={(action, point) =>
              props.onSend({
                t: "selection",
                paneId: props.paneId,
                action,
                ...(point ? { xPx: point.x, yPx: point.y } : {}),
              })
            }
            selection={props.selection}
            width={props.width}
          />
          <SelectionHandle
            height={props.height}
            kind="end"
            metrics={props.metrics}
            onLoupe={setLoupe}
            onSend={(action, point) =>
              props.onSend({
                t: "selection",
                paneId: props.paneId,
                action,
                ...(point ? { xPx: point.x, yPx: point.y } : {}),
              })
            }
            selection={props.selection}
            width={props.width}
          />
          <View style={styles.selectionToolbar}>
            <ToolbarButton label="Copy" onPress={props.onCopy} />
            <ToolbarButton
              label="All"
              onPress={() => props.onSend({ t: "selection", paneId: props.paneId, action: "all" })}
            />
            <ToolbarButton
              label="Clear"
              onPress={() => props.onSend({ t: "selection", paneId: props.paneId, action: "clear" })}
            />
          </View>
        </>
      ) : null}
      {displayedLoupe?.label ? (
        <View
          pointerEvents="none"
          style={[
            styles.loupe,
            {
              left: Math.max(8, Math.min(displayedLoupe.x - 58, props.width - 124)),
              top: Math.max(8, displayedLoupe.y - 68),
            },
          ]}
        >
          <Text numberOfLines={1} style={styles.loupeText}>
            {selectionLabel || displayedLoupe.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ToolbarButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${label} terminal selection`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
    >
      <Text style={styles.toolbarButtonText}>{label}</Text>
    </Pressable>
  );
}

interface HandleConfig {
  anchor: Point | undefined;
  height: number;
  kind: "end" | "start";
  onLoupe: (state: LoupeState | undefined) => void;
  onSend: (action: Extract<ToHost, { t: "selection" }>["action"], point?: Point) => void;
  position: Point | undefined;
  width: number;
}

class HandleGestureController {
  private config: HandleConfig;
  private terminalOrigin: Point = { x: 0, y: 0 };

  constructor(config: HandleConfig) {
    this.config = config;
  }

  update(config: HandleConfig): void {
    this.config = config;
  }

  grant(event: GestureResponderEvent): void {
    this.terminalOrigin = {
      x: event.nativeEvent.pageX - event.nativeEvent.locationX - (this.config.position?.x ?? 0) + 13,
      y: event.nativeEvent.pageY - event.nativeEvent.locationY - (this.config.position?.y ?? 0) + 13,
    };
    if (this.config.anchor) this.config.onSend("start", this.config.anchor);
  }

  move(gesture: PanResponderGestureState): void {
    const point = this.point(gesture);
    this.config.onSend("move", point);
    this.config.onLoupe({
      ...point,
      label: `${this.config.kind === "start" ? "Start" : "End"} handle`,
    });
  }

  release(gesture: PanResponderGestureState): void {
    this.config.onSend("end", this.point(gesture));
    this.config.onLoupe(undefined);
  }

  private point(gesture: PanResponderGestureState): Point {
    return clampTerminalPoint(
      {
        x: gesture.moveX - this.terminalOrigin.x,
        y: gesture.moveY - this.terminalOrigin.y,
      },
      this.config.width,
      this.config.height,
    );
  }
}

function SelectionHandle({
  height,
  kind,
  metrics,
  onLoupe,
  onSend,
  selection,
  width,
}: {
  height: number;
  kind: "end" | "start";
  metrics: TerminalMetrics;
  onLoupe: (state: LoupeState | undefined) => void;
  onSend: (action: Extract<ToHost, { t: "selection" }>["action"], point?: Point) => void;
  selection: TerminalSelection;
  width: number;
}) {
  const position = kind === "start" ? selection.startPx : selection.endPx;
  const anchor = selectionAnchorPoint(selection, metrics, kind);
  const [controller] = useState(
    () => new HandleGestureController({ anchor, height, kind, onLoupe, onSend, position, width }),
  );
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => controller.grant(event),
      onPanResponderMove: (_event, gesture) => controller.move(gesture),
      onPanResponderRelease: (_event, gesture) => controller.release(gesture),
      onPanResponderTerminationRequest: () => false,
      onStartShouldSetPanResponder: () => true,
    }),
  );

  useEffect(() => {
    controller.update({ anchor, height, kind, onLoupe, onSend, position, width });
  }, [anchor, controller, height, kind, onLoupe, onSend, position, width]);
  if (!position) return null;

  return (
    <View
      accessibilityLabel={`${kind} selection handle`}
      accessibilityRole="adjustable"
      style={[
        styles.selectionHandle,
        {
          left: Math.max(0, Math.min(position.x - 13, width - 26)),
          top: Math.max(0, Math.min(position.y - (kind === "start" ? 26 : 0), height - 26)),
        },
      ]}
      {...responder.panHandlers}
    >
      <View style={styles.selectionHandleStem} />
      <View style={styles.selectionHandleKnob} />
    </View>
  );
}

const styles = StyleSheet.create({
  touchSurface: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2,
  },
  selectionToolbar: {
    alignSelf: "center",
    backgroundColor: "#171b22f2",
    borderColor: colors.accentLine,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    padding: 3,
    position: "absolute",
    top: 8,
    zIndex: 5,
  },
  toolbarButton: {
    borderRadius: 7,
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolbarButtonText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  selectionHandle: {
    alignItems: "center",
    height: 26,
    justifyContent: "center",
    position: "absolute",
    width: 26,
    zIndex: 6,
  },
  selectionHandleStem: {
    backgroundColor: colors.accent,
    height: 14,
    width: 2,
  },
  selectionHandleKnob: {
    backgroundColor: colors.accent,
    borderColor: "#ffffff",
    borderRadius: 6,
    borderWidth: 1,
    height: 11,
    width: 11,
  },
  loupe: {
    alignItems: "center",
    backgroundColor: "#171b22f5",
    borderColor: colors.accent,
    borderRadius: 13,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    position: "absolute",
    width: 116,
    zIndex: 7,
  },
  loupeText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 10,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.65,
  },
});
