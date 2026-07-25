import type { EventServerMessage } from "../../protocol/wmux";

import { webSocketUrl } from "@/api/client";

export type EventStreamStatus = "connecting" | "live" | "reconnecting" | "stopped";

export const reconnectDelay = (attempt: number, jitter = Math.random()): number => {
  const boundedAttempt = Math.max(0, Math.min(attempt, 4));
  const base = Math.min(750 * 2 ** boundedAttempt, 8_000);
  return Math.round(base * (0.8 + Math.max(0, Math.min(jitter, 1)) * 0.4));
};

const isEventServerMessage = (value: unknown): value is EventServerMessage => {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "ready" ||
    type === "snapshot" ||
    type === "health" ||
    type === "notification" ||
    type === "media" ||
    type === "clipboard" ||
    type === "state"
  );
};

export interface EventStreamOptions {
  baseUrl: string;
  token: string | undefined;
  onMessage: (message: EventServerMessage) => void;
  onOpen: (reconnected: boolean) => void;
  onStatus: (status: EventStreamStatus) => void;
}

export class EventStream {
  private attempt = 0;
  private hadOpen = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private socket: WebSocket | undefined;
  private stopped = true;

  constructor(private readonly options: EventStreamOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.options.onStatus("stopped");
  }

  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus(this.hadOpen ? "reconnecting" : "connecting");
    const socket = new WebSocket(webSocketUrl(this.options.baseUrl, "/ws/events", this.options.token));
    this.socket = socket;

    socket.onopen = () => {
      if (this.stopped || socket !== this.socket) return;
      const reconnected = this.hadOpen;
      this.hadOpen = true;
      this.attempt = 0;
      this.options.onStatus("live");
      this.options.onOpen(reconnected);
    };
    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.socket || typeof event.data !== "string") return;
      try {
        const message: unknown = JSON.parse(event.data);
        if (isEventServerMessage(message)) this.options.onMessage(message);
      } catch {
        // Ignore malformed event frames and keep the live connection healthy.
      }
    };
    socket.onerror = () => {
      // The close handler owns retry scheduling.
    };
    socket.onclose = () => {
      if (this.stopped || socket !== this.socket) return;
      this.socket = undefined;
      this.options.onStatus("reconnecting");
      const delay = reconnectDelay(this.attempt);
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }
}
