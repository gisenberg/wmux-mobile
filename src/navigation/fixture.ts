import type { BootstrapPayload, PaneState, SurfaceTab, Workspace } from "../../protocol/wmux";

const createdAt = "2026-07-25T12:00:00.000Z";

const pane = (id: string, machineId: string, title: string, status: PaneState["status"]): PaneState => ({
  createdAt,
  id,
  machineId,
  status,
  title,
});

const tab = (id: string, title: string, panes: PaneState[]): SurfaceTab => ({
  activePaneId: panes[0]?.id ?? "",
  createdAt,
  id,
  layout:
    panes.length > 1 && panes[0] && panes[1]
      ? {
          direction: "horizontal",
          first: { paneId: panes[0].id, type: "pane" },
          ratio: 0.56,
          second: { paneId: panes[1].id, type: "pane" },
          type: "split",
        }
      : { paneId: panes[0]?.id ?? "", type: "pane" },
  panes,
  title,
});

const workspace = (id: string, name: string, descriptor: string, machineId: string, tabs: SurfaceTab[]): Workspace => ({
  activeTabId: tabs[0]?.id ?? "",
  createdAt,
  descriptor,
  id,
  machineId,
  name,
  tabs,
  updatedAt: createdAt,
});

const shellPane = pane("pane-shell", "machine-local", "zsh", "running");
const logsPane = pane("pane-logs", "machine-local", "server logs", "running");
const editorPane = pane("pane-editor", "machine-local", "vim", "running");
const remotePane = pane("pane-remote", "machine-remote", "remote shell", "idle");
const agentPane = pane("pane-agent", "machine-remote", "codex", "running");

const workspaces = [
  workspace("workspace-project", "wmux mobile", "Expo native client", "machine-local", [
    tab("tab-shell", "shell", [shellPane]),
    tab("tab-editor", "editor", [editorPane, logsPane]),
    tab("tab-tests", "tests", [pane("pane-tests", "machine-local", "test runner", "idle")]),
  ]),
  workspace("workspace-remote", "remote ops", "Private tailnet host", "machine-remote", [
    tab("tab-remote", "host", [remotePane]),
    tab("tab-agent", "agent", [agentPane]),
  ]),
];

const fixtureSettings: BootstrapPayload["settings"] = {
  collapsedWorkspaceIds: [],
  colorScheme: "wmux",
  favoriteWorkspaceIds: [],
  inactiveTabStreaming: "suspend",
  machineAliases: {},
  terminalFontSize: 14,
  terminalScrollMode: "batched",
  terminalScrollbackRows: 5_000,
  tuiFrameRate: 30,
};

export const navigationFixture: BootstrapPayload = {
  activeWorkspaceId: "workspace-project",
  agentEvents: [],
  agentTimelines: [],
  delegation: {
    notificationBudgetSeconds: { running: 7_200, waiting: 300 },
    preferHeadless: false,
    waitTimeoutBoundsSeconds: { max: 14_400, min: 0.1 },
    waitTimeoutSeconds: { change: 7_200, deploy: 7_200, review: 1_800 },
  },
  delegations: [],
  eventRevision: 0,
  healthEpoch: 1,
  keybindings: {} as BootstrapPayload["keybindings"],
  machines: [
    {
      checkedAt: createdAt,
      id: "machine-local",
      kind: "local",
      name: "Local Mac",
      platform: "mac",
      reachable: true,
      releaseVersion: "v0.1.0-mac",
    },
    {
      checkedAt: createdAt,
      id: "machine-remote",
      kind: "ssh",
      name: "Remote Linux",
      platform: "linux",
      reachable: true,
      releaseVersion: "v0.1.0-linux",
    },
  ],
  notifications: [],
  revision: 7,
  runs: [],
  settings: fixtureSettings,
  settingsDefaults: { ...fixtureSettings },
  streams: [],
  terminalFontFamily: '"Fira Code", monospace',
  workspaceTreeRevision: 0,
  workspaces,
};
