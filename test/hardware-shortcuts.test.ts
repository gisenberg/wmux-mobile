import assert from "node:assert/strict";
import test from "node:test";

import {
  compileHardwareShortcuts,
  matchHardwareShortcut,
  numberedShortcutPosition,
  terminalShortcutInput,
  type HardwareKeyChord,
} from "../src/input/hardware-shortcuts";

const chord = (code: string, modifiers: Partial<Omit<HardwareKeyChord, "code">> = {}): HardwareKeyChord => ({
  alt: false,
  code,
  ctrl: false,
  meta: false,
  shift: false,
  ...modifiers,
});

test("iPad Command chords resolve wmux's default app actions", () => {
  const shortcuts = compileHardwareShortcuts(undefined, true);
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT", { meta: true })), "tab.new");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyW", { meta: true })), "tab.close");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyW", { meta: true, shift: true })), "workspace.close");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyN", { meta: true })), "workspace.new");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyB", { meta: true })), "sidebar.toggle");
  assert.equal(matchHardwareShortcut(shortcuts, chord("BracketRight", { meta: true, shift: true })), "tab.next");
  assert.equal(matchHardwareShortcut(shortcuts, chord("BracketLeft", { meta: true, shift: true })), "tab.previous");
  assert.equal(matchHardwareShortcut(shortcuts, chord("BracketRight", { ctrl: true, meta: true })), "workspace.next");
  assert.equal(matchHardwareShortcut(shortcuts, chord("Digit3", { meta: true })), "workspace.select3");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyD", { meta: true })), "pane.splitRight");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyD", { meta: true, shift: true })), "pane.splitDown");
  assert.equal(matchHardwareShortcut(shortcuts, chord("ArrowRight", { alt: true, meta: true })), "pane.focusNext");
  assert.equal(
    matchHardwareShortcut(shortcuts, chord("KeyU", { meta: true, shift: true })),
    "notification.latestUnread",
  );
});

test("Control and Option chords stay with the terminal", () => {
  const shortcuts = compileHardwareShortcuts(undefined, true);
  for (const code of ["KeyW", "KeyD", "KeyB", "KeyT", "KeyN", "KeyK", "KeyU"]) {
    assert.equal(matchHardwareShortcut(shortcuts, chord(code, { ctrl: true })), undefined, `Ctrl+${code}`);
  }
  assert.equal(matchHardwareShortcut(shortcuts, chord("Tab", { ctrl: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("Digit1", { alt: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("BracketRight", { alt: true, ctrl: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyK", { meta: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT")), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("", { meta: true })), undefined);
});

test("terminal-context actions produce the web client's byte sequences", () => {
  const shortcuts = compileHardwareShortcuts(undefined, true);
  const newline = matchHardwareShortcut(shortcuts, chord("Enter", { shift: true }));
  const previous = matchHardwareShortcut(shortcuts, chord("ArrowLeft", { alt: true }));
  const next = matchHardwareShortcut(shortcuts, chord("ArrowRight", { alt: true }));
  assert.equal(newline, "terminal.insertNewline");
  assert.equal(previous, "terminal.wordPrevious");
  assert.equal(next, "terminal.wordNext");
  assert.equal(terminalShortcutInput[newline!], "\n");
  assert.equal(terminalShortcutInput[previous!], "\x1bb");
  assert.equal(terminalShortcutInput[next!], "\x1bf");
  assert.equal(matchHardwareShortcut(shortcuts, chord("Enter")), undefined);
});

test("server keybinding overrides replace defaults and invalid chords are ignored", () => {
  const shortcuts = compileHardwareShortcuts(
    {
      "settings.open": ["Primary+Comma"],
      "tab.new": ["Meta+Shift+KeyT", "not a chord"],
      "terminal.insertNewline": [],
    },
    true,
  );
  assert.equal(matchHardwareShortcut(shortcuts, chord("Comma", { meta: true })), "settings.open");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT", { meta: true, shift: true })), "tab.new");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT", { meta: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("Enter", { shift: true })), undefined);
});

test("non-Apple keyboards keep explicit Meta chords and leave Primary Control chords to the terminal", () => {
  const shortcuts = compileHardwareShortcuts({ "settings.open": ["Primary+Comma"] }, false);
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT", { meta: true })), "tab.new");
  assert.equal(matchHardwareShortcut(shortcuts, chord("KeyT", { ctrl: true })), undefined);
  assert.equal(matchHardwareShortcut(shortcuts, chord("Comma", { ctrl: true })), undefined);
});

test("numbered shortcuts expose their position", () => {
  assert.equal(numberedShortcutPosition("workspace.select4"), 4);
  assert.equal(numberedShortcutPosition("tab.select9"), 9);
  assert.equal(numberedShortcutPosition("tab.next"), undefined);
});
