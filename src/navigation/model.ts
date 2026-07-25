import type { BootstrapPayload, PaneState, SurfaceTab, Workspace } from "../../protocol/wmux";

export interface NavigationSelection {
  workspaceId: string;
  tabId: string;
  paneId: string;
}

export interface ResolvedNavigation {
  selection: NavigationSelection;
  workspace: Workspace;
  tab: SurfaceTab;
  pane: PaneState;
}

export const resolveNavigation = (
  bootstrap: BootstrapPayload | null,
  preferred?: Partial<NavigationSelection> | null,
): ResolvedNavigation | null => {
  if (!bootstrap?.workspaces.length) return null;

  const workspace =
    bootstrap.workspaces.find((candidate) => candidate.id === preferred?.workspaceId) ??
    bootstrap.workspaces.find((candidate) => candidate.id === bootstrap.activeWorkspaceId) ??
    bootstrap.workspaces[0];
  if (!workspace) return null;

  const tab =
    workspace.tabs.find((candidate) => candidate.id === preferred?.tabId) ??
    workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId) ??
    workspace.tabs[0];
  if (!tab) return null;

  const pane =
    tab.panes.find((candidate) => candidate.id === preferred?.paneId) ??
    tab.panes.find((candidate) => candidate.id === tab.activePaneId) ??
    tab.panes[0];
  if (!pane) return null;

  return {
    selection: {
      workspaceId: workspace.id,
      tabId: tab.id,
      paneId: pane.id,
    },
    workspace,
    tab,
    pane,
  };
};

export const selectWorkspace = (bootstrap: BootstrapPayload, workspaceId: string): ResolvedNavigation | null =>
  resolveNavigation(bootstrap, { workspaceId });

export const selectTab = (
  bootstrap: BootstrapPayload,
  current: NavigationSelection,
  tabId: string,
): ResolvedNavigation | null =>
  resolveNavigation(bootstrap, {
    workspaceId: current.workspaceId,
    tabId,
  });

export const selectPane = (
  bootstrap: BootstrapPayload,
  current: NavigationSelection,
  paneId: string,
): ResolvedNavigation | null =>
  resolveNavigation(bootstrap, {
    workspaceId: current.workspaceId,
    tabId: current.tabId,
    paneId,
  });

export const cycleTab = (
  bootstrap: BootstrapPayload,
  current: NavigationSelection,
  direction: -1 | 1,
): ResolvedNavigation | null => {
  const resolved = resolveNavigation(bootstrap, current);
  if (!resolved || resolved.workspace.tabs.length < 2) return resolved;
  const currentIndex = resolved.workspace.tabs.findIndex((tab) => tab.id === resolved.tab.id);
  const nextIndex = (currentIndex + direction + resolved.workspace.tabs.length) % resolved.workspace.tabs.length;
  const nextTab = resolved.workspace.tabs[nextIndex];
  return nextTab ? selectTab(bootstrap, resolved.selection, nextTab.id) : resolved;
};
