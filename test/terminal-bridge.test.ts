import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  TERMINAL_POOL_CAPACITY,
  decodeToHost,
  decodeToNative,
  encodeBridgeMessage,
  type HostSettings,
  type ToHost,
  type ToNative,
} from "../src/terminal/bridge";

const settings: HostSettings = {
  terminalFontSize: 14,
  terminalScrollbackRows: 10_000,
  colorScheme: "wmux",
  tuiFrameRate: 30,
  terminalScrollMode: "batched",
};

test("terminal bridge decodes every native-to-host command family", () => {
  const messages: ToHost[] = [
    { t: "init", serverUrl: "https://wmux.example.test", token: "secret", settings },
    { t: "attach", paneId: "pane-1" },
    { t: "show", paneId: "pane-1" },
    { t: "detach", paneId: "pane-1" },
    { t: "viewport", paneId: "pane-1", widthPx: 390, heightPx: 700, dpr: 3 },
    {
      t: "key",
      paneId: "pane-1",
      key: "ArrowUp",
      code: "ArrowUp",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    },
    { t: "text", paneId: "pane-1", data: "λ" },
    { t: "paste", paneId: "pane-1", text: "two\nlines" },
    { t: "scroll", paneId: "pane-1", deltaLines: -3.5 },
    { t: "scrollToBottom", paneId: "pane-1" },
    { t: "selection", paneId: "pane-1", action: "start", xPx: 10, yPx: 20 },
    { t: "copySelection", paneId: "pane-1" },
    { t: "settings", settings },
  ];

  for (const message of messages) {
    assert.deepEqual(decodeToHost(encodeBridgeMessage(message)), { ok: true, value: message });
  }
  assert.equal(TERMINAL_POOL_CAPACITY, 3);
});

test("terminal bridge rejects malformed and non-finite native input", () => {
  const malformed = [
    "{",
    { t: "attach", paneId: "" },
    { t: "viewport", paneId: "pane-1", widthPx: Number.NaN, heightPx: 100, dpr: 2 },
    { t: "key", paneId: "pane-1", key: "a", code: "KeyA", ctrl: "false" },
    { t: "selection", paneId: "pane-1", action: "diagonal" },
    { t: "settings", settings: { ...settings, colorScheme: "unknown" } },
  ];

  for (const message of malformed) assert.equal(decodeToHost(message).ok, false);
});

test("terminal bridge validates host-to-native messages before React Native consumes them", () => {
  const messages: ToNative[] = [
    { t: "ready" },
    { t: "pane", paneId: "pane-1", state: "live" },
    { t: "metrics", paneId: "pane-1", cols: 80, rows: 24, cellW: 8.5, cellH: 17 },
    { t: "title", paneId: "pane-1", title: "shell" },
    { t: "bell", paneId: "pane-1" },
    { t: "osc52", paneId: "pane-1", text: "copied" },
    { t: "altScreen", paneId: "pane-1", active: true },
    { t: "cursor", paneId: "pane-1", xPx: 4, yPx: 12, visible: true },
    {
      t: "selection",
      paneId: "pane-1",
      active: true,
      startPx: { x: 0, y: 0 },
      endPx: { x: 20, y: 18 },
      text: "hi",
    },
    {
      t: "media",
      paneId: "pane-1",
      name: "pixel.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    },
    { t: "exit", paneId: "pane-1", code: 0 },
    { t: "log", level: "warn", message: "test" },
  ];

  for (const message of messages) {
    assert.deepEqual(decodeToNative(encodeBridgeMessage(message)), { ok: true, value: message });
  }
  assert.equal(decodeToNative({ t: "metrics", paneId: "pane-1", cols: 0, rows: 24, cellW: 8, cellH: 16 }).ok, false);
});

test("terminal output bytes are absent from the low-frequency bridge contract", async () => {
  const source = await readFile(path.resolve("src/terminal/bridge.ts"), "utf8");
  assert.doesNotMatch(source, /\bt:\s*"output"/);
});
