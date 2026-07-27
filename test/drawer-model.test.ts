import assert from "node:assert/strict";
import test from "node:test";

import type { AgentActivity, TerminalNotification, Workspace } from "../protocol/wmux";
import {
  drawerAgentState,
  drawerWorkspaceSignals,
  normalizeDrawerPath,
  paneDrawerLabel,
  paneUnreadCount,
} from "../src/navigation/drawer-model";

const workspace: Workspace = {
  activeTabId: "tab-1",
  createdAt: "2026-07-27T00:00:00.000Z",
  id: "workspace-1",
  machineId: "machine-1",
  name: "wmux mobile",
  tabs: [
    {
      activePaneId: "pane-1",
      createdAt: "2026-07-27T00:00:00.000Z",
      id: "tab-1",
      layout: { paneId: "pane-1", type: "pane" },
      panes: [
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          cwd: "C:\\Users\\gisenberg\\git\\wmux-mobile",
          id: "pane-1",
          machineId: "machine-1",
          status: "running",
          title: "Shell",
        },
      ],
      title: "Shell",
    },
  ],
  updatedAt: "2026-07-27T00:00:00.000Z",
};

const notifications: TerminalNotification[] = [
  {
    body: "Needs review",
    createdAt: "2026-07-27T00:03:00.000Z",
    id: "unread",
    paneId: "pane-1",
    read: false,
    subtitle: "",
    tabId: "tab-1",
    title: "Codex",
    workspaceId: "workspace-1",
  },
  {
    body: "Already seen",
    createdAt: "2026-07-27T00:02:00.000Z",
    id: "read",
    paneId: "pane-1",
    read: true,
    subtitle: "",
    tabId: "tab-1",
    title: "Codex",
    workspaceId: "workspace-1",
  },
];

const agentEvents: AgentActivity[] = [
  {
    agent: "codex",
    createdAt: "2026-07-27T00:01:00.000Z",
    id: "older",
    paneId: "pane-1",
    status: "completed",
    summary: "Done",
    tabId: "tab-1",
    title: "Older event",
    workspaceId: "workspace-1",
  },
  {
    agent: "codex",
    createdAt: "2026-07-27T00:04:00.000Z",
    id: "latest",
    paneId: "pane-1",
    status: "working",
    summary: "Implementing drawer",
    tabId: "tab-1",
    title: "Active event",
    workspaceId: "workspace-1",
  },
];

test("drawer signals expose normalized CWD, latest agent state, and unread alerts", () => {
  const pane = workspace.tabs[0]!.panes[0]!;
  assert.deepEqual(drawerWorkspaceSignals({ agentEvents, notifications }, workspace, pane), {
    agent: {
      name: "codex",
      state: "working",
      status: "working",
    },
    cwd: "~/git/wmux-mobile",
    unreadCount: 1,
  });
  assert.equal(paneUnreadCount(notifications, pane.id), 1);
});

test("drawer paths normalize user homes across supported platforms", () => {
  assert.equal(normalizeDrawerPath("/Users/gisenberg/git/wmux-mobile"), "~/git/wmux-mobile");
  assert.equal(normalizeDrawerPath("/home/gisenberg/git/wmux"), "~/git/wmux");
  assert.equal(normalizeDrawerPath("/root/src/wmux"), "~/src/wmux");
});

test("generic shell labels yield to CWD while useful pane titles remain", () => {
  const tab = workspace.tabs[0]!;
  const pane = tab.panes[0]!;
  assert.equal(paneDrawerLabel(tab, pane, 0, true), "~/git/wmux-mobile");
  assert.equal(paneDrawerLabel({ ...tab, title: "tests" }, pane, 0, true), "tests");
  assert.equal(paneDrawerLabel(tab, { ...pane, title: "server logs" }, 0, false), "server logs");
});

test("agent status vocabulary maps to compact drawer states", () => {
  assert.equal(drawerAgentState("in_progress"), "working");
  assert.equal(drawerAgentState("approval_required"), "waiting");
  assert.equal(drawerAgentState("success"), "completed");
  assert.equal(drawerAgentState("error"), "failed");
  assert.equal(drawerAgentState("reconnected"), "updated");
});
