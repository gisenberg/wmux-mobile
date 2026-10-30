import {
  KEYBINDING_ACTIONS,
  keyChordMatches,
  keybindingContext,
  parseKeyChord,
  resolveKeybindings,
  type KeybindingAction,
  type KeybindingMap,
  type ParsedKeyChord,
} from "../../protocol/keybindings";

export type HardwareShortcutAction = Exclude<KeybindingAction, "commandPalette.open" | "settings.save">;

export interface HardwareKeyChord {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface HardwareShortcuts {
  readonly apple: boolean;
  readonly chords: ReadonlyMap<HardwareShortcutAction, readonly ParsedKeyChord[]>;
}

const unsupportedActions = new Set<KeybindingAction>(["commandPalette.open", "settings.save"]);

const isSupportedAction = (action: KeybindingAction): action is HardwareShortcutAction =>
  !unsupportedActions.has(action);

const resolvesToCommand = (chord: ParsedKeyChord, apple: boolean): boolean =>
  chord.modifiers.has("Meta") || (apple && chord.modifiers.has("Primary"));

const parsedChords = (values: readonly string[]): ParsedKeyChord[] =>
  values.flatMap((value) => {
    try {
      return [parseKeyChord(value)];
    } catch {
      return [];
    }
  });

/**
 * Compiles the server's resolved wmux keybindings for a native hardware keyboard.
 *
 * Global actions only keep chords that resolve to Command (Meta). On a touch device the terminal is the primary
 * surface, so Control and Option chords such as Ctrl+W, Ctrl+D, or a tmux Ctrl+B prefix always reach the PTY.
 */
export const compileHardwareShortcuts = (
  bindings: Partial<KeybindingMap> | undefined,
  apple: boolean,
): HardwareShortcuts => {
  const resolved = resolveKeybindings(bindings);
  const chords = new Map<HardwareShortcutAction, ParsedKeyChord[]>();
  for (const action of KEYBINDING_ACTIONS) {
    if (!isSupportedAction(action)) continue;
    const global = keybindingContext(action) === "global";
    const usable = parsedChords(resolved[action]).filter((chord) => !global || resolvesToCommand(chord, apple));
    if (usable.length) chords.set(action, usable);
  }
  return { apple, chords };
};

export const matchHardwareShortcut = (
  shortcuts: HardwareShortcuts,
  event: HardwareKeyChord,
): HardwareShortcutAction | undefined => {
  if (!event.code) return undefined;
  const keyboardEvent = {
    altKey: event.alt,
    code: event.code,
    ctrlKey: event.ctrl,
    metaKey: event.meta,
    shiftKey: event.shift,
  };
  for (const [action, chords] of shortcuts.chords) {
    if (chords.some((chord) => keyChordMatches(keyboardEvent, chord, shortcuts.apple))) return action;
  }
  return undefined;
};

export const numberedShortcutPosition = (action: HardwareShortcutAction): number | undefined => {
  const digit = /^(?:workspace|tab)\.select([1-9])$/.exec(action)?.[1];
  return digit ? Number(digit) : undefined;
};

/** Terminal byte sequences for wmux's terminal-context actions, matching the web client's custom key handler. */
export const terminalShortcutInput: Readonly<Partial<Record<HardwareShortcutAction, string>>> = {
  "terminal.insertNewline": "\n",
  "terminal.wordNext": "\x1bf",
  "terminal.wordPrevious": "\x1bb",
};
