import assert from "node:assert/strict";
import test from "node:test";

import type { BootstrapPayload, Workspace } from "../protocol/wmux";
import { navigationFixture } from "../src/navigation/fixture";
import { drawerMachineName, drawerWorkspaceGroups } from "../src/navigation/sidebar-model";

const workspace = (id: string, machineId: string, parentWorkspaceId?: string): Workspace => {
  const source = navigationFixture.workspaces[0]!;
  const sourceTab = source.tabs[0]!;
  const sourcePane = sourceTab.panes[0]!;
  const paneId = `pane-${id}`;
  const tabId = `tab-${id}`;
  return {
    ...source,
    activeTabId: tabId,
    id,
    machineId,
    name: id,
    ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
    tabs: [
      {
        ...sourceTab,
        activePaneId: paneId,
        id: tabId,
        layout: { paneId, type: "pane" },
        panes: [{ ...sourcePane, id: paneId, machineId }],
      },
    ],
  };
};

const sidebarFixture = (): BootstrapPayload => ({
  ...structuredClone(navigationFixture),
  activeWorkspaceId: "remote",
  settings: {
    ...navigationFixture.settings,
    collapsedWorkspaceIds: [],
    favoriteWorkspaceIds: ["favorite", "child"],
    groupSidebarSessionsByHost: true,
    machineAliases: { "machine-local": "Local alias" },
  },
  workspaces: [
    workspace("root", "machine-local"),
    workspace("child", "machine-local", "root"),
    workspace("favorite", "machine-local"),
    workspace("remote", "machine-remote"),
  ],
});

test("sidebar grouping follows wmux machine order and favorite tree order", () => {
  const fixture = sidebarFixture();
  const groups = drawerWorkspaceGroups(fixture);

  assert.deepEqual(
    groups.map((group) => ({
      machineId: group.machineId,
      workspaces: group.rows.map((row) => row.workspace.id),
    })),
    [
      { machineId: "machine-local", workspaces: ["favorite", "root", "child"] },
      { machineId: "machine-remote", workspaces: ["remote"] },
    ],
  );
  assert.equal(groups[0]?.rows[2]?.depth, 1);
  assert.equal(drawerMachineName(fixture, "machine-local"), "Local alias");
});

test("single-list sidebar preserves the same favorite and hierarchy ordering", () => {
  const fixture = sidebarFixture();
  fixture.settings.groupSidebarSessionsByHost = false;

  const groups = drawerWorkspaceGroups(fixture);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.rows.map((row) => row.workspace.id),
    ["favorite", "root", "child", "remote"],
  );
});

test("collapsed workspace groups reopen the active workspace ancestry", () => {
  const fixture = sidebarFixture();
  fixture.settings.collapsedWorkspaceIds = ["root"];

  assert.equal(
    drawerWorkspaceGroups(fixture)
      .flatMap((group) => group.rows)
      .some((row) => row.workspace.id === "child"),
    false,
  );

  assert.equal(
    drawerWorkspaceGroups(fixture, "child")
      .flatMap((group) => group.rows)
      .some((row) => row.workspace.id === "child"),
    true,
  );
});

test("agent activity groups a workspace by the agent pane presentation host", () => {
  const fixture = sidebarFixture();
  const target = fixture.workspaces.find((candidate) => candidate.id === "root")!;
  const remotePane = { ...target.tabs[0]!.panes[0]!, id: "pane-agent", machineId: "machine-remote" };
  const remoteTab = {
    ...target.tabs[0]!,
    activePaneId: remotePane.id,
    id: "tab-agent",
    layout: { paneId: remotePane.id, type: "pane" as const },
    panes: [remotePane],
  };
  target.tabs.push(remoteTab);
  fixture.agentEvents = [
    {
      agent: "codex",
      createdAt: "2026-08-10T12:00:00.000Z",
      id: "agent-root",
      paneId: remotePane.id,
      status: "working",
      summary: "Working remotely",
      tabId: remoteTab.id,
      title: "Agent",
      workspaceId: target.id,
    },
  ];

  const remoteGroup = drawerWorkspaceGroups(fixture).find((group) => group.machineId === "machine-remote");
  assert.equal(
    remoteGroup?.rows.some((row) => row.workspace.id === target.id),
    true,
  );
});
