import type { BootstrapPayload, LayoutNode, PaneState, SurfaceTab, Workspace } from "../../protocol/wmux";

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

/** Matches the web client's numbered shortcuts, where 9 always selects the last item. */
export const numberedItem = <T>(items: readonly T[], position: number): T | undefined =>
  position === 9 ? items.at(-1) : items[position - 1];

const layoutPaneIds = (node: LayoutNode): string[] =>
  node.type === "pane" ? [node.paneId] : [...layoutPaneIds(node.first), ...layoutPaneIds(node.second)];

export const orderedTabPanes = (tab: SurfaceTab): PaneState[] => {
  const paneById = new Map(tab.panes.map((pane) => [pane.id, pane]));
  const ordered = layoutPaneIds(tab.layout).flatMap((paneId) => {
    const pane = paneById.get(paneId);
    if (!pane) return [];
    paneById.delete(paneId);
    return [pane];
  });
  return [...ordered, ...paneById.values()];
};

export const cyclePane = (
  bootstrap: BootstrapPayload,
  current: NavigationSelection,
  direction: -1 | 1,
): ResolvedNavigation | null => {
  const resolved = resolveNavigation(bootstrap, current);
  if (!resolved) return null;
  const panes = orderedTabPanes(resolved.tab);
  if (panes.length < 2) return resolved;
  const currentIndex = panes.findIndex((pane) => pane.id === resolved.pane.id);
  const nextPane = panes[(currentIndex + direction + panes.length) % panes.length];
  return nextPane ? selectPane(bootstrap, resolved.selection, nextPane.id) : resolved;
};

export const selectTabAt = (
  bootstrap: BootstrapPayload,
  current: NavigationSelection,
  position: number,
): ResolvedNavigation | null => {
  const resolved = resolveNavigation(bootstrap, current);
  const tab = resolved ? numberedItem(resolved.workspace.tabs, position) : undefined;
  return resolved && tab ? selectTab(bootstrap, resolved.selection, tab.id) : null;
};

export const latestUnreadNavigation = (bootstrap: BootstrapPayload): ResolvedNavigation | null => {
  const unread = bootstrap.notifications
    .filter((notification) => !notification.read)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  for (const notification of unread) {
    const resolved = resolveNavigation(bootstrap, notification);
    if (resolved?.pane.id === notification.paneId) return resolved;
  }
  return null;
};
