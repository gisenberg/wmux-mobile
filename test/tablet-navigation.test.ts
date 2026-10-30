import assert from "node:assert/strict";
import test from "node:test";

import type { BootstrapPayload, TerminalNotification } from "../protocol/wmux";
import { tabStripLabel, tabUnreadCount } from "../src/navigation/drawer-model";
import { navigationFixture } from "../src/navigation/fixture";
import {
  cyclePane,
  latestUnreadNavigation,
  numberedItem,
  orderedTabPanes,
  resolveNavigation,
  selectTab,
  selectTabAt,
} from "../src/navigation/model";
import { cycleWorkspace, drawerNavigationTargets, selectWorkspaceAt } from "../src/navigation/sidebar-model";
import { formFactorForWidth, REGULAR_LAYOUT_MIN_WIDTH } from "../src/ui/layout";

const initial = resolveNavigation(navigationFixture)!.selection;

const notification = (
  id: string,
  paneId: string,
  tabId: string,
  workspaceId: string,
  createdAt: string,
  read = false,
) =>
  ({
    body: "",
    createdAt,
    id,
    paneId,
    read,
    subtitle: "",
    tabId,
    title: id,
    workspaceId,
  }) satisfies TerminalNotification;

test("wide windows use the sidebar layout while phones and narrow multitasking windows use the drawer", () => {
  assert.equal(formFactorForWidth(393), "compact");
  assert.equal(formFactorForWidth(834), "compact");
  assert.equal(formFactorForWidth(REGULAR_LAYOUT_MIN_WIDTH), "regular");
  assert.equal(formFactorForWidth(1032), "regular");
  assert.equal(formFactorForWidth(1376), "regular");
});

test("numbered selection treats nine as the last item like the web client", () => {
  assert.equal(numberedItem(["a", "b", "c"], 2), "b");
  assert.equal(numberedItem(["a", "b", "c"], 9), "c");
  assert.equal(numberedItem(["a", "b", "c"], 5), undefined);
  assert.equal(selectTabAt(navigationFixture, initial, 3)?.tab.id, "tab-tests");
  assert.equal(selectTabAt(navigationFixture, initial, 9)?.tab.id, "tab-tests");
  assert.equal(selectTabAt(navigationFixture, initial, 4), null);
});

test("pane focus cycles in split layout order and wraps", () => {
  const editor = selectTab(navigationFixture, initial, "tab-editor")!;
  assert.deepEqual(
    orderedTabPanes(editor.tab).map((pane) => pane.id),
    ["pane-editor", "pane-logs"],
  );
  const next = cyclePane(navigationFixture, editor.selection, 1);
  assert.equal(next?.pane.id, "pane-logs");
  assert.equal(cyclePane(navigationFixture, next!.selection, 1)?.pane.id, "pane-editor");
  assert.equal(cyclePane(navigationFixture, initial, 1)?.pane.id, "pane-shell");
});

test("workspace shortcuts follow the visible sidebar order", () => {
  const targets = drawerNavigationTargets(navigationFixture, initial.workspaceId);
  assert.deepEqual(
    targets.map((target) => target.workspace.id),
    ["workspace-project", "workspace-remote"],
  );
  assert.equal(cycleWorkspace(navigationFixture, initial, 1)?.workspace.id, "workspace-remote");
  assert.equal(cycleWorkspace(navigationFixture, initial, -1)?.workspace.id, "workspace-remote");
  assert.equal(selectWorkspaceAt(navigationFixture, initial, 1)?.workspace.id, "workspace-project");
  assert.equal(selectWorkspaceAt(navigationFixture, initial, 9)?.workspace.id, "workspace-remote");
  assert.equal(selectWorkspaceAt(navigationFixture, initial, 3), null);
});

test("latest unread navigation opens the newest unread pane that still exists", () => {
  const bootstrap: BootstrapPayload = {
    ...navigationFixture,
    notifications: [
      notification("old", "pane-logs", "tab-editor", "workspace-project", "2026-07-25T12:01:00.000Z"),
      notification("read", "pane-agent", "tab-agent", "workspace-remote", "2026-07-25T12:05:00.000Z", true),
      notification("stale", "pane-removed", "tab-removed", "workspace-project", "2026-07-25T12:04:00.000Z"),
      notification("new", "pane-remote", "tab-remote", "workspace-remote", "2026-07-25T12:03:00.000Z"),
    ],
  };
  assert.equal(latestUnreadNavigation(bootstrap)?.pane.id, "pane-remote");
  assert.equal(latestUnreadNavigation(navigationFixture), null);
  assert.equal(tabUnreadCount(bootstrap.notifications, "tab-editor"), 1);
  assert.equal(tabUnreadCount(bootstrap.notifications, "tab-agent"), 0);
});

test("tab strip labels prefer meaningful titles over generic shell names", () => {
  const project = navigationFixture.workspaces[0]!;
  assert.equal(tabStripLabel(project.tabs[1]!, 1), "editor");
  const genericTab = { ...project.tabs[0]!, title: "zsh" };
  assert.equal(tabStripLabel(genericTab, 0), "Tab 1");
  const cwdTab = { ...genericTab, panes: [{ ...genericTab.panes[0]!, cwd: "/Users/someone/src/wmux" }] };
  assert.equal(tabStripLabel(cwdTab, 0), "wmux");
  const titledPane = { ...genericTab, panes: [{ ...genericTab.panes[0]!, title: "htop" }] };
  assert.equal(tabStripLabel(titledPane, 0), "htop");
});
