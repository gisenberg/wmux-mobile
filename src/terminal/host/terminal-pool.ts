import type { Ghostty } from "ghostty-web";

import { TERMINAL_POOL_CAPACITY, type HostSettings, type ToHost, type ToNative } from "../bridge";
import { TerminalSession, type TerminalSessionSnapshot } from "./terminal-session";

export interface TerminalPoolSnapshot {
  activePaneId?: string;
  sessions: TerminalSessionSnapshot[];
}

interface TerminalPoolOptions {
  ghostty: Ghostty;
  parent: HTMLElement;
  emit: (message: ToNative) => void;
}

export class TerminalPool {
  private readonly ghostty: Ghostty;
  private readonly parent: HTMLElement;
  private readonly emit: (message: ToNative) => void;
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly recency = new Map<string, number>();
  private activityClock = 0;
  private activePaneId: string | undefined;
  private serverUrl: string | undefined;
  private token: string | undefined;
  private settings: HostSettings | undefined;

  constructor(options: TerminalPoolOptions) {
    this.ghostty = options.ghostty;
    this.parent = options.parent;
    this.emit = options.emit;
  }

  receive(message: ToHost): void {
    if (message.t === "init") {
      this.initialize(message.serverUrl, message.token, message.settings);
      return;
    }
    if (message.t === "settings") {
      this.settings = message.settings;
      for (const session of this.sessions.values()) session.applySettings(message.settings);
      return;
    }
    if (message.t === "attach") {
      this.ensureSession(message.paneId);
      return;
    }
    if (message.t === "show") {
      this.show(message.paneId);
      return;
    }
    if (message.t === "detach") {
      this.detach(message.paneId);
      return;
    }
    const session = this.sessions.get(message.paneId);
    if (!session) {
      this.emit({
        t: "log",
        level: "warn",
        message: `Ignored ${message.t} for an unattached pane`,
      });
      return;
    }
    session.handle(message);
  }

  dispose(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.recency.clear();
    this.activePaneId = undefined;
  }

  snapshot(): TerminalPoolSnapshot {
    return {
      ...(this.activePaneId === undefined ? {} : { activePaneId: this.activePaneId }),
      sessions: [...this.sessions.values()].map((session) => session.snapshot()),
    };
  }

  private initialize(serverUrl: string, token: string, settings: HostSettings): void {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.token = token;
    this.settings = settings;
    for (const session of this.sessions.values()) {
      session.updateConnection(this.serverUrl, token);
      session.applySettings(settings);
    }
  }

  private show(paneId: string): void {
    const target = this.ensureSession(paneId);
    if (!target) return;
    this.activePaneId = paneId;
    for (const [candidatePaneId, session] of this.sessions) {
      session.setVisible(candidatePaneId === paneId);
    }
    this.touch(paneId);
  }

  private detach(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;
    session.dispose();
    this.sessions.delete(paneId);
    this.recency.delete(paneId);
    if (this.activePaneId !== paneId) return;
    this.activePaneId = undefined;
    const nextPaneId = mostRecentPane(this.recency);
    if (nextPaneId) this.show(nextPaneId);
  }

  private ensureSession(paneId: string): TerminalSession | undefined {
    const existing = this.sessions.get(paneId);
    if (existing) {
      this.touch(paneId);
      return existing;
    }
    if (!this.serverUrl || this.token === undefined || !this.settings) {
      this.emit({ t: "log", level: "error", message: "Terminal host must be initialized before attaching a pane" });
      return undefined;
    }
    const session = new TerminalSession({
      paneId,
      ghostty: this.ghostty,
      parent: this.parent,
      serverUrl: this.serverUrl,
      token: this.token,
      settings: this.settings,
      emit: this.emit,
      onActivity: () => this.touch(paneId),
    });
    this.sessions.set(paneId, session);
    this.touch(paneId);
    this.evictOverflow();
    return this.sessions.get(paneId);
  }

  private evictOverflow(): void {
    while (this.sessions.size > TERMINAL_POOL_CAPACITY) {
      const candidates = [...this.recency.entries()]
        .filter(([paneId]) => paneId !== this.activePaneId)
        .sort((first, second) => first[1] - second[1]);
      const paneId = candidates[0]?.[0] ?? [...this.recency.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (!paneId) return;
      this.sessions.get(paneId)?.dispose("Evicted from the local terminal pool");
      this.sessions.delete(paneId);
      this.recency.delete(paneId);
    }
  }

  private touch(paneId: string): void {
    this.activityClock += 1;
    this.recency.set(paneId, this.activityClock);
  }
}

const normalizeServerUrl = (input: string): string => {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("wmux server URL must use HTTPS or HTTP");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const mostRecentPane = (recency: ReadonlyMap<string, number>): string | undefined =>
  [...recency.entries()].sort((first, second) => second[1] - first[1])[0]?.[0];
