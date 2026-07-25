import { Key, KeyAction, KeyEncoderOption, Mods, type Ghostty, type KeyEncoder, type Terminal } from "ghostty-web";

import type { ToHost } from "../bridge";

type NativeKeyMessage = Extract<ToHost, { t: "key" }>;

const namedKeys: Readonly<Record<string, Key>> = {
  AltLeft: Key.ALT_LEFT,
  AltRight: Key.ALT_RIGHT,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  ArrowUp: Key.UP,
  Backquote: Key.GRAVE,
  Backslash: Key.BACKSLASH,
  Backspace: Key.BACKSPACE,
  BracketLeft: Key.BRACKET_LEFT,
  BracketRight: Key.BRACKET_RIGHT,
  CapsLock: Key.CAPS_LOCK,
  Comma: Key.COMMA,
  ContextMenu: Key.CONTEXT_MENU,
  ControlLeft: Key.CONTROL_LEFT,
  ControlRight: Key.CONTROL_RIGHT,
  Delete: Key.DELETE,
  End: Key.END,
  Enter: Key.ENTER,
  Equal: Key.EQUAL,
  Escape: Key.ESCAPE,
  Help: Key.HELP,
  Home: Key.HOME,
  Insert: Key.INSERT,
  IntlBackslash: Key.INTL_BACKSLASH,
  IntlRo: Key.INTL_RO,
  IntlYen: Key.INTL_YEN,
  MetaLeft: Key.META_LEFT,
  MetaRight: Key.META_RIGHT,
  Minus: Key.MINUS,
  NumLock: Key.NUM_LOCK,
  NumpadAdd: Key.KP_PLUS,
  NumpadBackspace: Key.KP_BACKSPACE,
  NumpadClear: Key.KP_CLEAR,
  NumpadComma: Key.KP_COMMA,
  NumpadDecimal: Key.KP_PERIOD,
  NumpadDivide: Key.KP_DIVIDE,
  NumpadEnter: Key.KP_ENTER,
  NumpadEqual: Key.KP_EQUAL,
  NumpadMultiply: Key.KP_MULTIPLY,
  NumpadSubtract: Key.KP_MINUS,
  PageDown: Key.PAGE_DOWN,
  PageUp: Key.PAGE_UP,
  Pause: Key.PAUSE,
  Period: Key.PERIOD,
  PrintScreen: Key.PRINT_SCREEN,
  Quote: Key.QUOTE,
  ScrollLock: Key.SCROLL_LOCK,
  Semicolon: Key.SEMICOLON,
  ShiftLeft: Key.SHIFT_LEFT,
  ShiftRight: Key.SHIFT_RIGHT,
  Slash: Key.SLASH,
  Space: Key.SPACE,
  Tab: Key.TAB,
};

const digitKeys = [
  Key.ZERO,
  Key.ONE,
  Key.TWO,
  Key.THREE,
  Key.FOUR,
  Key.FIVE,
  Key.SIX,
  Key.SEVEN,
  Key.EIGHT,
  Key.NINE,
] as const;

const numpadDigitKeys = [
  Key.KP_0,
  Key.KP_1,
  Key.KP_2,
  Key.KP_3,
  Key.KP_4,
  Key.KP_5,
  Key.KP_6,
  Key.KP_7,
  Key.KP_8,
  Key.KP_9,
] as const;

const functionKeys = [
  Key.F1,
  Key.F2,
  Key.F3,
  Key.F4,
  Key.F5,
  Key.F6,
  Key.F7,
  Key.F8,
  Key.F9,
  Key.F10,
  Key.F11,
  Key.F12,
  Key.F13,
  Key.F14,
  Key.F15,
  Key.F16,
  Key.F17,
  Key.F18,
  Key.F19,
  Key.F20,
  Key.F21,
  Key.F22,
  Key.F23,
  Key.F24,
] as const;

export class SemanticKeyEncoder {
  private readonly encoder: KeyEncoder;
  private readonly decoder = new TextDecoder();

  constructor(
    ghostty: Ghostty,
    private readonly terminal: Terminal,
  ) {
    this.encoder = ghostty.createKeyEncoder();
    this.encoder.setOption(KeyEncoderOption.ALT_ESC_PREFIX, true);
  }

  encode(message: NativeKeyMessage): string {
    const key = keyFromCode(message.code);
    if (key === null) return "";
    this.encoder.setOption(KeyEncoderOption.CURSOR_KEY_APPLICATION, this.terminal.getMode(1));
    this.encoder.setOption(KeyEncoderOption.KEYPAD_KEY_APPLICATION, this.terminal.getMode(66));
    const utf8 = utf8ForKey(message);
    const event = {
      action: KeyAction.PRESS,
      key,
      mods: modifiers(message),
      ...(utf8 === undefined ? {} : { utf8 }),
    };
    const encoded = this.encoder.encode(event);
    return encoded.length === 0 ? "" : this.decoder.decode(encoded);
  }

  dispose(): void {
    this.encoder.dispose();
  }
}

export const keyFromCode = (code: string): Key | null => {
  const named = namedKeys[code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) {
    const candidate = Key[letter as keyof typeof Key];
    return typeof candidate === "number" ? candidate : null;
  }
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit) return digitKeys[Number(digit)] ?? null;
  const numpadDigit = /^Numpad([0-9])$/.exec(code)?.[1];
  if (numpadDigit) return numpadDigitKeys[Number(numpadDigit)] ?? null;
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)?.[1];
  if (functionKey) return functionKeys[Number(functionKey) - 1] ?? null;
  return null;
};

const modifiers = (message: NativeKeyMessage): Mods => {
  let value = Mods.NONE;
  if (message.shift) value |= Mods.SHIFT;
  if (message.ctrl) value |= Mods.CTRL;
  if (message.alt) value |= Mods.ALT;
  if (message.meta) value |= Mods.SUPER;
  return value;
};

const utf8ForKey = (message: NativeKeyMessage): string | undefined => {
  if (!message.key || message.key === "Dead" || message.key === "Unidentified") return undefined;
  const codePoint = message.key.codePointAt(0);
  const codePointLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  if (message.key.length !== codePointLength) return undefined;
  if (message.alt && codePoint !== undefined && codePoint > 127 && /^Key[A-Z]$/.test(message.code)) {
    return message.code.slice(-1).toLowerCase();
  }
  return message.key;
};
