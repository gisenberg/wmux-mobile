import type { NavigationSelection } from "@/navigation/model";

export const parseNavigationSelection = (value: unknown): NavigationSelection | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<NavigationSelection>;
  if (
    typeof candidate.workspaceId !== "string" ||
    !candidate.workspaceId ||
    typeof candidate.tabId !== "string" ||
    !candidate.tabId ||
    typeof candidate.paneId !== "string" ||
    !candidate.paneId
  ) {
    return undefined;
  }
  return {
    paneId: candidate.paneId,
    tabId: candidate.tabId,
    workspaceId: candidate.workspaceId,
  };
};

export const sameNavigationSelection = (
  first: NavigationSelection | null | undefined,
  second: NavigationSelection | null | undefined,
): boolean =>
  first?.workspaceId === second?.workspaceId && first?.tabId === second?.tabId && first?.paneId === second?.paneId;
