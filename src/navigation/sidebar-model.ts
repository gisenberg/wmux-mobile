import type { AgentActivity, BootstrapPayload, PaneState, SurfaceTab, Workspace } from "../../protocol/wmux";

export interface DrawerWorkspaceRow {
  depth: number;
  favorite: boolean;
  machineId: string;
  pane: PaneState;
  parentId?: string;
  tab: SurfaceTab;
  workspace: Workspace;
}

export interface DrawerWorkspaceGroup {
  machineId?: string;
  rows: DrawerWorkspaceRow[];
}

export const drawerMachineName = (bootstrap: BootstrapPayload, machineId: string): string => {
  const machine = bootstrap.machines.find((candidate) => candidate.id === machineId);
  return bootstrap.settings.machineAliases[machineId]?.trim() || machine?.name || machineId;
};

export const drawerWorkspaceGroups = (
  bootstrap: BootstrapPayload,
  activeWorkspaceId = bootstrap.activeWorkspaceId,
): DrawerWorkspaceGroup[] => {
  const rows = visibleWorkspaceRows(bootstrap, activeWorkspaceId).flatMap((row): DrawerWorkspaceRow[] => {
    const target = workspacePresentationTarget(row.workspace, latestAgentFor(bootstrap.agentEvents, row.workspace.id));
    if (!target.tab || !target.pane) return [];
    return [
      {
        depth: row.depth,
        favorite: bootstrap.settings.favoriteWorkspaceIds.includes(row.workspace.id),
        machineId: target.machineId,
        pane: target.pane,
        ...(row.parentId ? { parentId: row.parentId } : {}),
        tab: target.tab,
        workspace: row.workspace,
      },
    ];
  });
  if (bootstrap.settings.groupSidebarSessionsByHost === false) {
    return [{ rows: sortFavoriteWorkspaceRows(rows) }];
  }

  const grouped = new Map<string, DrawerWorkspaceRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.machineId) ?? [];
    group.push(row);
    grouped.set(row.machineId, group);
  }
  const machineIds = [...bootstrap.machines.map((machine) => machine.id), ...grouped.keys()].filter(
    (machineId, index, values) => grouped.has(machineId) && values.indexOf(machineId) === index,
  );
  return machineIds.map((machineId) => ({
    machineId,
    rows: sortFavoriteWorkspaceRows(grouped.get(machineId) ?? []),
  }));
};

const visibleWorkspaceRows = (
  bootstrap: BootstrapPayload,
  activeWorkspaceId: string,
): { workspace: Workspace; depth: number; parentId?: string }[] => {
  const workspaceById = new Map(bootstrap.workspaces.map((workspace) => [workspace.id, workspace]));
  const childrenByParentId = new Map<string | undefined, Workspace[]>();
  for (const workspace of bootstrap.workspaces) {
    const parentId =
      workspace.parentWorkspaceId && workspaceById.has(workspace.parentWorkspaceId)
        ? workspace.parentWorkspaceId
        : undefined;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(workspace);
    childrenByParentId.set(parentId, siblings);
  }

  const activeAncestors = new Set<string>();
  let active = workspaceById.get(activeWorkspaceId);
  const activeSeen = new Set<string>();
  while (active?.parentWorkspaceId && !activeSeen.has(active.parentWorkspaceId)) {
    activeSeen.add(active.parentWorkspaceId);
    activeAncestors.add(active.parentWorkspaceId);
    active = workspaceById.get(active.parentWorkspaceId);
  }

  const collapsed = new Set(bootstrap.settings.collapsedWorkspaceIds);
  const rows: { workspace: Workspace; depth: number; parentId?: string }[] = [];
  const visited = new Set<string>();
  const visit = (workspace: Workspace, depth: number, parentId?: string): void => {
    if (visited.has(workspace.id)) return;
    visited.add(workspace.id);
    rows.push({ workspace, depth, ...(parentId ? { parentId } : {}) });
    if (collapsed.has(workspace.id) && !activeAncestors.has(workspace.id)) return;
    for (const child of childrenByParentId.get(workspace.id) ?? []) visit(child, depth + 1, workspace.id);
  };
  for (const root of childrenByParentId.get(undefined) ?? []) visit(root, 0);
  return rows;
};

const sortFavoriteWorkspaceRows = <T extends { workspace: { id: string }; parentId?: string; favorite: boolean }>(
  rows: readonly T[],
): T[] => {
  const rowById = new Map(rows.map((row) => [row.workspace.id, row]));
  const childrenByParentId = new Map<string | undefined, T[]>();
  for (const row of rows) {
    const parentId =
      row.parentId && row.parentId !== row.workspace.id && rowById.has(row.parentId) ? row.parentId : undefined;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(row);
    childrenByParentId.set(parentId, siblings);
  }
  const favoriteFirst = (siblings: readonly T[]): T[] =>
    siblings
      .map((row, index) => ({ index, row }))
      .sort((first, second) => Number(second.row.favorite) - Number(first.row.favorite) || first.index - second.index)
      .map(({ row }) => row);
  const sorted: T[] = [];
  const visited = new Set<string>();
  const visit = (row: T): void => {
    if (visited.has(row.workspace.id)) return;
    visited.add(row.workspace.id);
    sorted.push(row);
    for (const child of favoriteFirst(childrenByParentId.get(row.workspace.id) ?? [])) visit(child);
  };
  for (const root of favoriteFirst(childrenByParentId.get(undefined) ?? [])) visit(root);
  for (const row of favoriteFirst(rows)) visit(row);
  return sorted;
};

const workspacePresentationTarget = (
  workspace: Workspace,
  agent: Pick<AgentActivity, "paneId" | "tabId"> | undefined,
): { machineId: string; tab?: SurfaceTab; pane?: PaneState } => {
  const agentTab = workspace.tabs.find((candidate) => candidate.id === agent?.tabId);
  const agentPane = agentTab?.panes.find((candidate) => candidate.id === agent?.paneId);
  if (agentTab && agentPane) return { machineId: agentPane.machineId, pane: agentPane, tab: agentTab };
  const tab = workspace.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace.tabs[0];
  const pane = tab?.panes.find((candidate) => candidate.id === tab.activePaneId) ?? tab?.panes[0];
  return {
    machineId: pane?.machineId || workspace.machineId,
    ...(pane ? { pane } : {}),
    ...(tab ? { tab } : {}),
  };
};

const latestAgentFor = (events: AgentActivity[], workspaceId: string): AgentActivity | undefined =>
  events.reduce<AgentActivity | undefined>((latest, event) => {
    if (event.workspaceId !== workspaceId) return latest;
    if (!latest) return event;
    return Date.parse(event.createdAt) >= Date.parse(latest.createdAt) ? event : latest;
  }, undefined);
