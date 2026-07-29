import assert from "node:assert/strict";
import test from "node:test";

import { mouseWheelInput, type MouseWheelTerminal } from "../src/terminal/host/mouse-wheel";

const terminal = (tracking: boolean, sgr: boolean, utf8 = false, cols = 80, rows = 24): MouseWheelTerminal => ({
  cols,
  rows,
  hasMouseTracking: () => tracking,
  getMode: (mode) => (mode === 1006 ? sgr : mode === 1005 && utf8),
  renderer: { getMetrics: () => ({ width: 10, height: 20 }) },
});

test("mouse wheel input maps direction, touch cells, and bounded repeats", () => {
  assert.equal(mouseWheelInput(terminal(true, true), -2.2, 34, 41), "\x1b[<64;4;3M".repeat(2));
  assert.equal(mouseWheelInput(terminal(true, true), 99, 999, 999), "\x1b[<65;80;24M".repeat(5));
});

test("SGR mouse coordinates are not constrained by the legacy encoding limit", () => {
  assert.equal(mouseWheelInput(terminal(true, true, false, 200, 200), 1, 1_990, 3_990), "\x1b[<65;200;200M");
});

test("mouse wheel input uses legacy encoding when SGR mouse is disabled", () => {
  assert.equal(mouseWheelInput(terminal(true, false), 1, 0, 0), "\x1b[M\x61\x21\x21");
});

test("legacy mouse coordinates clamp without 1005 and use UTF-8 extension with it", () => {
  assert.equal(mouseWheelInput(terminal(true, false, false, 200, 200), 1, 1_990, 3_990), "\x1b[Ma\x7f\x7f");
  assert.equal(mouseWheelInput(terminal(true, false, true, 200, 200), 1, 1_990, 3_990), "\x1b[Maèè");
});

test("mouse wheel input is absent without terminal mouse tracking", () => {
  assert.equal(mouseWheelInput(terminal(false, true), -1, 10, 10), undefined);
});
