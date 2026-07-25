import type { BootstrapPayload, EventServerMessage } from "../../protocol/wmux";

export const applyEventMessage = (current: BootstrapPayload, message: EventServerMessage): BootstrapPayload => {
  if (message.type === "snapshot") return message.state;
  if (message.type === "health") {
    return {
      ...current,
      healthEpoch: message.healthEpoch,
      machines: message.machines ?? current.machines,
      revision: Math.max(current.revision, message.revision),
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
