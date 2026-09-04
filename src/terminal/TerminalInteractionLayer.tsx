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
  clampTerminalPoint,
  selectionAnchorPoint,
  type TerminalMetrics,
  type TerminalSelection,
} from "@/terminal/interactions";
import {
  TerminalGestureController,
  type LoupeState,
  type TerminalInteractionLayerProps,
} from "@/terminal/gesture-controller";
import { colors, fonts } from "@/ui/theme";

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
