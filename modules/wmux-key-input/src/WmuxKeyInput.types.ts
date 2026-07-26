import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

export interface WmuxKeyInputKeyEvent {
  key: string;
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  repeat: boolean;
  source: "accessory" | "hardware" | "ime";
}

export interface WmuxKeyInputTextEvent {
  data: string;
}

export interface WmuxKeyInputPasteEvent {
  text: string;
}

export interface WmuxKeyInputFocusEvent {
  focused: boolean;
}

export interface WmuxKeyInputModifierEvent {
  ctrl: "off" | "armed" | "locked";
  alt: "off" | "armed" | "locked";
}

export interface WmuxKeyInputRef {
  focus(): Promise<void>;
  blur(): Promise<void>;
  sendKey(key: string, code: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean): Promise<void>;
  sendText(data: string): Promise<void>;
  startKeyRepeat(key: string, code: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean): Promise<void>;
  stopKeyRepeat(): Promise<void>;
}

export interface WmuxKeyInputViewProps {
  altSendsMeta?: boolean;
  autoFocus?: boolean;
  onFocusChange?: (event: NativeSyntheticEvent<WmuxKeyInputFocusEvent>) => void;
  onKey?: (event: NativeSyntheticEvent<WmuxKeyInputKeyEvent>) => void;
  onModifierState?: (event: NativeSyntheticEvent<WmuxKeyInputModifierEvent>) => void;
  onPaste?: (event: NativeSyntheticEvent<WmuxKeyInputPasteEvent>) => void;
  onText?: (event: NativeSyntheticEvent<WmuxKeyInputTextEvent>) => void;
  style?: StyleProp<ViewStyle>;
}
