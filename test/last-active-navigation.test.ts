import assert from "node:assert/strict";
import test from "node:test";

import { parseNavigationSelection, sameNavigationSelection } from "../src/navigation/last-active";

const selection = {
  paneId: "pane-1",
  tabId: "tab-1",
  workspaceId: "workspace-1",
};

test("last active navigation accepts complete selections and rejects stale shapes", () => {
  assert.deepEqual(parseNavigationSelection(selection), selection);
  assert.equal(parseNavigationSelection({ workspaceId: "workspace-1" }), undefined);
  assert.equal(parseNavigationSelection({ ...selection, paneId: "" }), undefined);
  assert.equal(parseNavigationSelection("workspace-1"), undefined);
});

test("navigation selection equality compares the entire resumable session", () => {
  assert.equal(sameNavigationSelection(selection, { ...selection }), true);
  assert.equal(sameNavigationSelection(selection, { ...selection, paneId: "pane-2" }), false);
  assert.equal(sameNavigationSelection(selection, undefined), false);
  assert.equal(sameNavigationSelection(undefined, undefined), true);
});
