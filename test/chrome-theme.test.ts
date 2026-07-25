import assert from "node:assert/strict";
import test from "node:test";

import { chromeTheme, normalizeTerminalColorScheme } from "../src/navigation/chrome-theme";

test("native chrome normalizes unknown server themes at the terminal boundary", () => {
  assert.equal(normalizeTerminalColorScheme("tokyo-night"), "tokyo-night");
  assert.equal(normalizeTerminalColorScheme("server-theme-not-yet-vendored"), "wmux");
  assert.equal(normalizeTerminalColorScheme(undefined), "wmux");
  assert.deepEqual(chromeTheme("server-theme-not-yet-vendored"), chromeTheme("wmux"));
});
