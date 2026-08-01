import type { BootstrapPayload, EventCollectionDelta, EventServerMessage, EventStateDelta } from "../../protocol/wmux";

const applyCollectionDelta = <T>(
  current: T[],
  delta: EventCollectionDelta<T> | undefined,
  idOf: (item: T) => string,
): T[] => {
  if (!delta) return current;
  const removed = new Set(delta.removedIds);
  const byId = new Map(current.filter((item) => !removed.has(idOf(item))).map((item) => [idOf(item), item]));
  for (const item of delta.upserted) byId.set(idOf(item), item);
  if (!delta.order) return [...byId.values()];
  return delta.order.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
};

export const eventDeltaRequiresResync = (current: BootstrapPayload, delta: EventStateDelta): boolean =>
  delta.healthEpoch > current.healthEpoch ||
  (delta.eventRevision > current.eventRevision && delta.baseEventRevision !== current.eventRevision);

export const bootstrapSatisfiesEventDelta = (
  required: Pick<EventStateDelta, "eventRevision" | "healthEpoch"> | null,
  incoming: Pick<BootstrapPayload, "eventRevision" | "healthEpoch">,
): boolean =>
  !required ||
  incoming.healthEpoch > required.healthEpoch ||
  (incoming.healthEpoch === required.healthEpoch && incoming.eventRevision >= required.eventRevision);

export const healthDeltaRequiresResync = (
  current: Pick<BootstrapPayload, "revision">,
  delta: Extract<EventServerMessage, { type: "health" }>,
): boolean => delta.revision > current.revision;

export const bootstrapSatisfiesHealthDelta = (
  required: Pick<BootstrapPayload, "revision" | "healthEpoch"> | null,
  incoming: Pick<BootstrapPayload, "revision" | "healthEpoch">,
): boolean =>
  !required ||
  incoming.revision > required.revision ||
  (incoming.revision === required.revision && incoming.healthEpoch >= required.healthEpoch);

export const isIncomingBootstrapStale = (
  current: Pick<BootstrapPayload, "revision" | "healthEpoch" | "eventRevision"> | null,
  incoming: Pick<BootstrapPayload, "revision" | "healthEpoch" | "eventRevision">,
): boolean =>
  Boolean(
    current &&
    (incoming.revision < current.revision ||
      (incoming.revision === current.revision &&
        (incoming.healthEpoch < current.healthEpoch ||
          (incoming.healthEpoch === current.healthEpoch && incoming.eventRevision < current.eventRevision)))),
  );

export const markWorkspaceNotificationsRead = (current: BootstrapPayload, workspaceId: string): BootstrapPayload => {
  let changed = false;
  const notifications = current.notifications.map((notification) => {
    if (notification.read || notification.workspaceId !== workspaceId) return notification;
    changed = true;
    return { ...notification, read: true };
  });
  return changed ? { ...current, notifications } : current;
};

export const applyEventMessage = (current: BootstrapPayload, message: EventServerMessage): BootstrapPayload => {
  if (message.type === "snapshot") {
    return isIncomingBootstrapStale(current, message.state) ? current : message.state;
  }
  if (message.type === "delta") {
    if (
      message.healthEpoch !== current.healthEpoch ||
      message.eventRevision <= current.eventRevision ||
      message.baseEventRevision !== current.eventRevision
    ) {
      return current;
    }
    if (message.revision < current.revision) {
      return { ...current, eventRevision: message.eventRevision };
    }
    return {
      ...current,
      eventRevision: message.eventRevision,
      revision: message.revision,
      ...(message.workspaces
        ? {
            workspaces: applyCollectionDelta(current.workspaces, message.workspaces.items, (workspace) => workspace.id),
            activeWorkspaceId: message.workspaces.activeWorkspaceId ?? current.activeWorkspaceId,
            workspaceTreeRevision: message.workspaces.workspaceTreeRevision ?? current.workspaceTreeRevision,
          }
        : {}),
      ...(message.notifications
        ? {
            notifications: applyCollectionDelta(
              current.notifications,
              message.notifications,
              (notification) => notification.id,
            ),
          }
        : {}),
      ...(message.agents
        ? {
            agentEvents: applyCollectionDelta(current.agentEvents, message.agents.events, (event) => event.id),
            delegations: applyCollectionDelta(
              current.delegations,
              message.agents.delegations,
              (delegation) => delegation.runId,
            ),
            agentTimelines: applyCollectionDelta(
              current.agentTimelines,
              message.agents.timelines,
              (timeline) => timeline.id,
            ),
          }
        : {}),
      ...(message.runs ? { runs: applyCollectionDelta(current.runs, message.runs, (run) => run.id) } : {}),
      ...(message.settings ? { settings: message.settings } : {}),
    };
  }
  if (message.type === "health") {
    if (message.revision !== current.revision || message.healthEpoch <= current.healthEpoch) {
      return current;
    }
    return {
      ...current,
      healthEpoch: message.healthEpoch,
      machines: message.machines ?? current.machines,
      streams: message.streams ?? current.streams,
    };
  }
  if (message.type === "notification") {
    return {
      ...current,
      notifications: [
        message.notification,
        ...current.notifications.filter((item) => item.id !== message.notification.id),
      ],
    };
  }
  return current;
};
