import type {
  AgentActivity,
  BootstrapPayload,
  PaneState,
  SurfaceTab,
  TerminalNotification,
  Workspace,
} from "../../protocol/wmux";

export type DrawerAgentState = "working" | "waiting" | "failed" | "completed" | "updated";

export interface DrawerAgentSignal {
  name: string;
  state: DrawerAgentState;
  status: string;
}

export interface DrawerWorkspaceSignals {
  agent?: DrawerAgentSignal;
  cwd: string;
  unreadCount: number;
}

export const drawerWorkspaceSignals = (
  bootstrap: Pick<BootstrapPayload, "agentEvents" | "notifications">,
  workspace: Workspace,
  pane: PaneState,
): DrawerWorkspaceSignals => {
  const latestAgent = latestActivity(bootstrap.agentEvents.filter((event) => event.workspaceId === workspace.id));
  const agentName = latestAgent?.agent.trim();
  return {
    cwd: normalizeDrawerPath(pane.cwd),
    unreadCount: unreadCount(bootstrap.notifications, "workspaceId", workspace.id),
    ...(latestAgent && agentName
      ? {
          agent: {
            name: agentName,
            state: drawerAgentState(latestAgent.status),
            status: latestAgent.status,
          },
        }
      : {}),
  };
};

export const paneUnreadCount = (notifications: TerminalNotification[], paneId: string): number =>
  unreadCount(notifications, "paneId", paneId);

export const paneDrawerLabel = (tab: SurfaceTab, pane: PaneState, paneIndex: number, showTabTitle: boolean): string => {
  const cwd = normalizeDrawerPath(pane.cwd);
  const paneTitle = pane.title.trim();
  const tabTitle = tab.title.trim();
  if (showTabTitle && !isGenericTerminalTitle(tabTitle)) return tabTitle;
  if (!isGenericTerminalTitle(paneTitle)) return paneTitle;
  return cwd || `Pane ${paneIndex + 1}`;
};

export const normalizeDrawerPath = (cwd: string | undefined): string => {
  let pathValue = cwd?.trim() ?? "";
  if (!pathValue) return "";
  pathValue = pathValue.replace(/\\/g, "/").replace(/\/+/g, "/");
  const windowsHome = pathValue.match(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i);
  if (windowsHome) return pathValue.replace(windowsHome[0], "~");
  const posixHome = pathValue.match(/^\/(?:home|Users)\/[^/]+(?=\/|$)/);
  if (posixHome) return pathValue.replace(posixHome[0], "~");
  if (/^\/root(?=\/|$)/.test(pathValue)) return pathValue.replace(/^\/root/, "~");
  return pathValue;
};

export const drawerAgentState = (status: string): DrawerAgentState => {
  const normalized = status.toLowerCase();
  if (["started", "running", "working", "in_progress", "active"].includes(normalized)) return "working";
  if (["waiting", "needs_input", "input_required", "approval_required"].includes(normalized)) return "waiting";
  if (
    ["completed", "complete", "succeeded", "success", "done", "stopped", "cancelled", "canceled"].includes(normalized)
  ) {
    return "completed";
  }
  if (["failed", "error"].includes(normalized)) return "failed";
  return "updated";
};

const latestActivity = (events: AgentActivity[]): AgentActivity | undefined =>
  events.reduce<AgentActivity | undefined>((latest, event) => {
    if (!latest) return event;
    return Date.parse(event.createdAt) >= Date.parse(latest.createdAt) ? event : latest;
  }, undefined);

const unreadCount = <K extends "paneId" | "workspaceId">(
  notifications: TerminalNotification[],
  key: K,
  id: string,
): number => notifications.filter((notification) => !notification.read && notification[key] === id).length;

const isGenericTerminalTitle = (value: string): boolean =>
  ["", "bash", "cmd", "powershell", "pwsh", "shell", "terminal", "zsh"].includes(value.trim().toLowerCase());
