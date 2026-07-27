import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTerminalLink } from "../src/terminal/links";

test("terminal links permit web navigation and reject unsafe or unsupported schemes", () => {
  assert.equal(
    normalizeTerminalLink("https://example.com/docs?q=wmux#mobile"),
    "https://example.com/docs?q=wmux#mobile",
  );
  assert.equal(normalizeTerminalLink("http://127.0.0.1:3000/path"), "http://127.0.0.1:3000/path");
  assert.equal(normalizeTerminalLink("javascript:alert(1)"), undefined);
  assert.equal(normalizeTerminalLink("file:///etc/passwd"), undefined);
  assert.equal(normalizeTerminalLink("not a URL"), undefined);
});
