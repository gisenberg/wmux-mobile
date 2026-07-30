import assert from "node:assert/strict";
import test from "node:test";

import { detectTerminalUrls } from "../src/terminal/host/wrapped-url-provider";

interface FakeLine {
  isWrapped: boolean;
  length: number;
  getCell(column: number): { getCodepoint(): number } | undefined;
}

const line = (value: string, isWrapped = false, width = value.length): FakeLine => ({
  isWrapped,
  length: width,
  getCell(column) {
    const character = value[column];
    return { getCodepoint: () => (character ? character.codePointAt(0)! : 0) };
  },
});

const buffer = (...lines: FakeLine[]) => ({
  length: lines.length,
  getLine: (row: number) => lines[row],
});

test("detects one HTTP URL across soft-wrapped terminal rows", () => {
  const detected = detectTerminalUrls(
    buffer(
      line("visit https://login.tail", false, 24),
      line("scale.com/a/1164725fb32546d", true, 28),
      line("next prompt", false, 28),
    ),
    1,
  );

  assert.deepEqual(detected, [
    {
      range: {
        end: { x: 26, y: 1 },
        start: { x: 6, y: 0 },
      },
      text: "https://login.tailscale.com/a/1164725fb32546d",
    },
  ]);
});

test("does not join URLs across explicit line boundaries", () => {
  assert.deepEqual(
    detectTerminalUrls(buffer(line("https://login.tailscale.", false, 24), line("com/a/not-wrapped", false, 24)), 1),
    [],
  );
});

test("trims sentence punctuation while preserving balanced URL parentheses", () => {
  const detected = detectTerminalUrls(buffer(line("see https://example.com/a_(b).", false, 32)), 0);

  assert.equal(detected[0]?.text, "https://example.com/a_(b)");
});
