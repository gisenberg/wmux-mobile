import type {
  AgentActivity,
  BootstrapPayload,
  PaneState,
  TerminalNotification,
  TerminalRun,
} from "../../protocol/wmux";

export type ChatThreadItem =
  | { kind: "agent"; id: string; createdAt: string; event: AgentActivity }
  | { kind: "notification"; id: string; createdAt: string; notification: TerminalNotification }
  | { kind: "run"; id: string; createdAt: string; run: TerminalRun };

export const buildChatThread = (bootstrap: BootstrapPayload, workspaceId: string, paneId: string): ChatThreadItem[] =>
  [
    ...bootstrap.agentEvents
      .filter((event) => event.workspaceId === workspaceId && event.paneId === paneId)
      .map((event) => ({
        kind: "agent" as const,
        id: `agent:${event.id}`,
        createdAt: event.createdAt,
        event,
      })),
    ...bootstrap.runs
      .filter((run) => run.workspaceId === workspaceId && run.paneId === paneId)
      .map((run) => ({
        kind: "run" as const,
        id: `run:${run.id}`,
        createdAt: run.completedAt ?? run.startedAt,
        run,
      })),
    ...bootstrap.notifications
      .filter((notification) => notification.workspaceId === workspaceId && notification.paneId === paneId)
      .map((notification) => ({
        kind: "notification" as const,
        id: `notification:${notification.id}`,
        createdAt: notification.createdAt,
        notification,
      })),
  ]
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
    .slice(-80);

export const detectedAgentName = (pane: PaneState, events: AgentActivity[], now = Date.now()): string | undefined => {
  const paneTitleAgent = agentNameFromText(pane.title);
  if (paneTitleAgent) return paneTitleAgent;

  const latest = events
    .filter((event) => event.paneId === pane.id)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0];
  if (!latest) return undefined;
  const ageMs = now - Date.parse(latest.createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 12 * 60 * 60 * 1000) return undefined;
  return latest.agent;
};

const agentNameFromText = (value: string): string | undefined => {
  const normalized = value.toLowerCase();
  if (/\bcodex\b/.test(normalized)) return "Codex";
  if (/\bclaude\b/.test(normalized)) return "Claude";
  return undefined;
};
