import assert from "node:assert/strict";
import test from "node:test";

import {
  base64FromDataUrl,
  clampTerminalPoint,
  consumeScrollPixels,
  nextTapTracker,
  quoteStagedImagePath,
  selectionAnchorPoint,
} from "../src/terminal/interactions";

test("tap tracking recognizes double and triple taps within the native gesture window", () => {
  const first = nextTapTracker(undefined, { x: 40, y: 60 }, 1_000);
  const second = nextTapTracker(first, { x: 42, y: 61 }, 1_180);
  const third = nextTapTracker(second, { x: 38, y: 64 }, 1_350);
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal(third.count, 3);
  assert.equal(nextTapTracker(third, { x: 140, y: 160 }, 1_400).count, 1);
});

test("scroll accumulation preserves sub-cell motion and emits whole terminal lines", () => {
  const first = consumeScrollPixels({ remainderPx: 0 }, 8, 20);
  assert.deepEqual(first, { deltaLines: 0, state: { remainderPx: 8 } });
  const second = consumeScrollPixels(first.state, 15, 20);
  assert.deepEqual(second, { deltaLines: 1, state: { remainderPx: 3 } });
  const reverse = consumeScrollPixels(second.state, -28, 20);
  assert.deepEqual(reverse, { deltaLines: -1, state: { remainderPx: -5 } });
});

test("selection geometry clamps to the terminal and reverses the dragged handle anchor", () => {
  assert.deepEqual(clampTerminalPoint({ x: -4, y: 320 }, 240, 180), { x: 0, y: 180 });
  const selection = {
    active: true,
    startPx: { x: 20, y: 30 },
    endPx: { x: 100, y: 70 },
  };
  const metrics = { cellH: 20, cellW: 10, cols: 24, rows: 9 };
  assert.deepEqual(selectionAnchorPoint(selection, metrics, "start"), { x: 95, y: 60 });
  assert.deepEqual(selectionAnchorPoint(selection, metrics, "end"), { x: 25, y: 40 });
});

test("image helpers validate clipboard data and safely quote staged paths", () => {
  assert.equal(base64FromDataUrl("data:image/png;base64,YWJjZA=="), "YWJjZA==");
  assert.equal(quoteStagedImagePath("/tmp/a'b.png"), "'/tmp/a'\\''b.png'");
  assert.equal(quoteStagedImagePath("C:\\Temp\\a'b.png"), "'C:\\Temp\\a''b.png'");
  assert.throws(() => base64FromDataUrl("data:text/plain;base64,YWJj"));
  assert.throws(() => quoteStagedImagePath("relative.png"));
});
