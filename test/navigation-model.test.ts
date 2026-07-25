import assert from "node:assert/strict";
import test from "node:test";

import { navigationFixture } from "../src/navigation/fixture";
import { cycleTab, resolveNavigation, selectPane, selectTab, selectWorkspace } from "../src/navigation/model";

test("navigation resolves server defaults and valid local preferences", () => {
  const initial = resolveNavigation(navigationFixture);
  assert.deepEqual(initial?.selection, {
    paneId: "pane-shell",
    tabId: "tab-shell",
    workspaceId: "workspace-project",
  });

  const remote = resolveNavigation(navigationFixture, {
    paneId: "pane-agent",
    tabId: "tab-agent",
    workspaceId: "workspace-remote",
  });
  assert.equal(remote?.pane.title, "codex");
});

test("navigation repairs stale workspace, tab, and pane ids from bootstrap state", () => {
  const resolved = resolveNavigation(navigationFixture, {
    paneId: "removed-pane",
    tabId: "removed-tab",
    workspaceId: "removed-workspace",
  });
  assert.equal(resolved?.workspace.id, "workspace-project");
  assert.equal(resolved?.tab.id, "tab-shell");
  assert.equal(resolved?.pane.id, "pane-shell");
});

test("workspace, tab, pane, and cycling actions always produce coherent selections", () => {
  const workspace = selectWorkspace(navigationFixture, "workspace-remote");
  assert.equal(workspace?.selection.tabId, "tab-remote");

  const tab = selectTab(navigationFixture, workspace!.selection, "tab-agent");
  assert.equal(tab?.selection.paneId, "pane-agent");

  const editor = selectTab(navigationFixture, resolveNavigation(navigationFixture)!.selection, "tab-editor");
  const logs = selectPane(navigationFixture, editor!.selection, "pane-logs");
  assert.equal(logs?.pane.title, "server logs");

  const next = cycleTab(navigationFixture, resolveNavigation(navigationFixture)!.selection, 1);
  assert.equal(next?.tab.id, "tab-editor");
  const wrapped = cycleTab(navigationFixture, next!.selection, -1);
  assert.equal(wrapped?.tab.id, "tab-shell");
});
