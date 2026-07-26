import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

import {
  WmuxKeyInputView,
  type WmuxKeyInputKeyEvent,
  type WmuxKeyInputModifierEvent,
  type WmuxKeyInputRef,
  type WmuxKeyInputTextEvent,
} from "../../modules/wmux-key-input";

import {
  initialModifierState,
  modifierIsActive,
  modifierReducer,
  type Modifier,
  type ModifierMode,
} from "@/input/modifiers";
import { colors, fonts } from "@/ui/theme";

export interface TerminalInputHandle {
  focus(): Promise<void>;
  blur(): Promise<void>;
}

interface TerminalInputProps {
  altSendsMeta?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onKey: (event: WmuxKeyInputKeyEvent) => void;
  onModifierState?: (event: WmuxKeyInputModifierEvent) => void;
  onPaste?: (text?: string) => void;
  onText: (event: WmuxKeyInputTextEvent) => void;
}

interface AccessoryKey {
  label: string;
  key: string;
  code: string;
}

const accessoryKeys: AccessoryKey[] = [
  { label: "Esc", key: "Escape", code: "Escape" },
  { label: "Tab", key: "Tab", code: "Tab" },
  { label: "←", key: "ArrowLeft", code: "ArrowLeft" },
  { label: "↑", key: "ArrowUp", code: "ArrowUp" },
  { label: "↓", key: "ArrowDown", code: "ArrowDown" },
  { label: "→", key: "ArrowRight", code: "ArrowRight" },
];

const literalKeys = ["|", "/", "~", "-", "_", "`"] as const;

export const TerminalInput = forwardRef<TerminalInputHandle, TerminalInputProps>(function TerminalInput(
  { altSendsMeta = false, onFocusChange, onKey, onModifierState, onPaste, onText },
  forwardedRef,
) {
  const nativeRef = useRef<WmuxKeyInputRef>(null);
  const repeatingKeyRef = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Platform.OS !== "android" || Keyboard.isVisible());
  const [modifiers, dispatchModifier] = useReducer(modifierReducer, initialModifierState);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: async () => {
        await nativeRef.current?.focus();
      },
      blur: async () => {
        await nativeRef.current?.blur();
      },
    }),
    [],
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;
    onModifierState?.({ ctrl: modifiers.ctrl, alt: modifiers.alt });
  }, [modifiers.alt, modifiers.ctrl, onModifierState]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const initiallyVisible = Keyboard.isVisible();
    if (!initiallyVisible) onFocusChange?.(false);
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
      onFocusChange?.(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      void nativeRef.current?.stopKeyRepeat();
      setKeyboardVisible(false);
      dispatchModifier({ type: "reset" });
      onFocusChange?.(false);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [onFocusChange]);

  const handleFocusChange = useCallback(
    (nextFocused: boolean): void => {
      setFocused(nextFocused);
      if (!nextFocused) {
        void nativeRef.current?.stopKeyRepeat();
        dispatchModifier({ type: "reset" });
      }
      onFocusChange?.(nextFocused);
    },
    [onFocusChange],
  );

  const tapModifier = useCallback((modifier: Modifier): void => {
    dispatchModifier({ type: "tap", modifier, at: Date.now() });
  }, []);

  const sendAccessoryKey = useCallback(
    (key: string, code: string): void => {
      void nativeRef.current?.sendKey(
        key,
        code,
        modifierIsActive(modifiers.ctrl),
        modifierIsActive(modifiers.alt),
        false,
        false,
      );
      dispatchModifier({ type: "consume" });
    },
    [modifiers.alt, modifiers.ctrl],
  );

  const startRepeatingAccessoryKey = useCallback(
    (key: string, code: string): void => {
      const ctrl = modifierIsActive(modifiers.ctrl);
      const alt = modifierIsActive(modifiers.alt);
      void nativeRef.current?.startKeyRepeat(key, code, ctrl, alt, false, false);
      dispatchModifier({ type: "consume" });
    },
    [modifiers.alt, modifiers.ctrl],
  );

  const sendLiteral = useCallback(
    (literal: string): void => {
      if (modifierIsActive(modifiers.ctrl) || modifierIsActive(modifiers.alt)) {
        sendAccessoryKey(literal, codeForCharacter(literal));
        return;
      }
      void nativeRef.current?.sendText(literal);
    },
    [modifiers.alt, modifiers.ctrl, sendAccessoryKey],
  );

  const handleNativeText = useCallback(
    (event: WmuxKeyInputTextEvent): void => {
      const ctrl = modifierIsActive(modifiers.ctrl);
      const alt = modifierIsActive(modifiers.alt);
      if (Platform.OS !== "android" || (!ctrl && !alt)) {
        onText(event);
        return;
      }

      const [first, ...remaining] = Array.from(event.data);
      if (!first) return;
      onKey({
        key: first,
        code: codeForCharacter(first),
        ctrl,
        alt: alt && !altSendsMeta,
        shift: false,
        meta: alt && altSendsMeta,
        repeat: false,
        source: "ime",
      });
      if (remaining.length) onText({ data: remaining.join("") });
      dispatchModifier({ type: "consume" });
    },
    [altSendsMeta, modifiers.alt, modifiers.ctrl, onKey, onText],
  );

  const handleNativeKey = useCallback(
    (event: WmuxKeyInputKeyEvent): void => {
      const stickyCtrl = modifierIsActive(modifiers.ctrl);
      const stickyAlt = modifierIsActive(modifiers.alt);
      if (Platform.OS !== "android" || event.source === "accessory" || (!stickyCtrl && !stickyAlt)) {
        onKey(event);
        return;
      }

      const alt = event.alt || stickyAlt;
      onKey({
        ...event,
        ctrl: event.ctrl || stickyCtrl,
        alt: alt && !altSendsMeta,
        meta: event.meta || (alt && altSendsMeta),
      });
      dispatchModifier({ type: "consume" });
    },
    [altSendsMeta, modifiers.alt, modifiers.ctrl, onKey],
  );

  return (
    <>
      <WmuxKeyInputView
        altSendsMeta={altSendsMeta}
        onFocusChange={(event) => handleFocusChange(event.nativeEvent.focused)}
        onKey={(event) => handleNativeKey(event.nativeEvent)}
        onModifierState={(event) => onModifierState?.(event.nativeEvent)}
        onPaste={(event) => onPaste?.(event.nativeEvent.text)}
        onText={(event) => handleNativeText(event.nativeEvent)}
        ref={nativeRef}
        style={styles.nativeInput}
      />
      {Platform.OS === "android" && focused && keyboardVisible ? (
        <KeyboardStickyView style={styles.stickyAccessory}>
          <View style={styles.accessory}>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.accessoryContent}
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
            >
              {accessoryKeys.slice(0, 2).map((item) => (
                <AccessoryButton
                  key={item.code}
                  label={item.label}
                  onPress={() => sendAccessoryKey(item.key, item.code)}
                />
              ))}
              <AccessoryButton label="Paste" onPress={() => onPaste?.()} />
              <ModifierButton label="Ctrl" mode={modifiers.ctrl} onPress={() => tapModifier("ctrl")} />
              <ModifierButton label="Alt" mode={modifiers.alt} onPress={() => tapModifier("alt")} />
              {accessoryKeys.slice(2).map((item) => (
                <AccessoryButton
                  key={item.code}
                  label={item.label}
                  onLongPress={() => {
                    repeatingKeyRef.current = item.code;
                    startRepeatingAccessoryKey(item.key, item.code);
                  }}
                  onPress={() => {
                    if (repeatingKeyRef.current === item.code) {
                      repeatingKeyRef.current = null;
                      return;
                    }
                    sendAccessoryKey(item.key, item.code);
                  }}
                  onPressOut={() => {
                    void nativeRef.current?.stopKeyRepeat();
                    queueMicrotask(() => {
                      if (repeatingKeyRef.current === item.code) repeatingKeyRef.current = null;
                    });
                  }}
                />
              ))}
              {literalKeys.map((literal) => (
                <AccessoryButton key={literal} label={literal} onPress={() => sendLiteral(literal)} />
              ))}
              <AccessoryButton
                accessibilityLabel="Dismiss terminal keyboard"
                label="⌄"
                onPress={() => void nativeRef.current?.blur()}
              />
            </ScrollView>
          </View>
        </KeyboardStickyView>
      ) : null}
    </>
  );
});

function AccessoryButton({
  accessibilityLabel,
  label,
  onLongPress,
  onPress,
  onPressOut,
}: {
  accessibilityLabel?: string;
  label: string;
  onLongPress?: () => void;
  onPress?: () => void;
  onPressOut?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? `${label} terminal key`}
      accessibilityRole="button"
      delayLongPress={420}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressOut={onPressOut}
      style={({ pressed }) => [styles.accessoryButton, pressed && styles.accessoryButtonPressed]}
    >
      <Text style={styles.accessoryButtonText}>{label}</Text>
    </Pressable>
  );
}

function ModifierButton({ label, mode, onPress }: { label: string; mode: ModifierMode; onPress: () => void }) {
  const active = mode !== "off";
  return (
    <Pressable
      accessibilityHint="Tap once for the next key. Double tap to lock."
      accessibilityLabel={`${label} terminal modifier`}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.accessoryButton,
        active && styles.modifierButtonActive,
        pressed && styles.accessoryButtonPressed,
      ]}
    >
      <Text style={[styles.accessoryButtonText, active && styles.modifierButtonTextActive]}>
        {label}
        {mode === "locked" ? " •" : ""}
      </Text>
    </Pressable>
  );
}

const codeForCharacter = (character: string): string => {
  if (/^[a-z]$/i.test(character)) return `Key${character.toUpperCase()}`;
  if (/^[0-9]$/.test(character)) return `Digit${character}`;
  if (character === " ") return "Space";
  if (character === "|" || character === "\\") return "Backslash";
  if (character === "/" || character === "?") return "Slash";
  if (character === "~" || character === "`") return "Backquote";
  if (character === "-" || character === "_") return "Minus";
  if (character === "=" || character === "+") return "Equal";
  if (character === "[" || character === "{") return "BracketLeft";
  if (character === "]" || character === "}") return "BracketRight";
  if (character === ";" || character === ":") return "Semicolon";
  if (character === "'" || character === '"') return "Quote";
  if (character === "," || character === "<") return "Comma";
  if (character === "." || character === ">") return "Period";
  return "";
};

const styles = StyleSheet.create({
  nativeInput: {
    bottom: 0,
    height: 2,
    opacity: 0.01,
    position: "absolute",
    right: 0,
    width: 2,
  },
  stickyAccessory: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 100,
  },
  accessory: {
    backgroundColor: colors.canvas,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    height: 48,
  },
  accessoryContent: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  accessoryButton: {
    alignItems: "center",
    backgroundColor: colors.line,
    borderColor: "#343a43",
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 42,
    paddingHorizontal: 10,
  },
  accessoryButtonPressed: {
    opacity: 0.62,
  },
  accessoryButtonText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: "700",
  },
  modifierButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modifierButtonTextActive: {
    color: colors.canvas,
  },
});
