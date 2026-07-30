import type { Ghostty, IDisposable, Terminal as GhosttyTerminal } from "ghostty-web";
import { LinkDetector, OSC8LinkProvider, Terminal } from "ghostty-web";

import type { PaneClientMessage, PaneServerMessage, PaneReplayKind } from "../../../protocol/wmux";
import type { HostSettings, ToHost, ToNative } from "../bridge";
import { SemanticKeyEncoder } from "./key-encoder";
import { mouseWheelInput } from "./mouse-wheel";
import { OutputPipeline } from "./output-pipeline";
import { colorSchemeById } from "./vendor/wmux/color-schemes";
import { WrappedUrlProvider } from "./wrapped-url-provider";

const REPLAY_CHUNK_CHARACTERS = 128 * 1024;
const RECONNECT_MAX_MS = 8_000;
const DURABLE_REFRESH_FIRST_NUDGE_MS = 120;
const DURABLE_REFRESH_QUIET_MS = 80;
const DURABLE_REFRESH_FALLBACK_MS = 700;
const EMPTY_REPLAY_REPAINT_MS = 700;
const REPAINT_INPUT = "\x0c";

interface TerminalSessionOptions {
  paneId: string;
  ghostty: Ghostty;
  parent: HTMLElement;
  serverUrl: string;
  token: string;
  settings: HostSettings;
  emit: (message: ToNative) => void;
  onActivity: () => void;
}

interface CellPoint {
  x: number;
  y: number;
}

export interface TerminalSessionSnapshot {
  paneId: string;
  cols: number;
  rows: number;
  visible: boolean;
  connected: boolean;
  replayKind?: PaneReplayKind;
  lines: string[];
  selection: string;
  scrollbackLength: number;
  viewportOffset: number;
}

export class TerminalSession {
  readonly paneId: string;

  private readonly emit: (message: ToNative) => void;
  private readonly onActivity: () => void;
  private readonly element: HTMLDivElement;
  private readonly terminal: GhosttyTerminal;
  private readonly linkDetector: LinkDetector;
  private readonly keyEncoder: SemanticKeyEncoder;
  private readonly pipeline: OutputPipeline;
  private readonly disposables: IDisposable[] = [];

  private settings: HostSettings;
  private serverUrl: string;
  private token: string;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  private disposed = false;
  private removed = false;
  private exited = false;
  private visible = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewportDpr = 1;
  private selectionAnchor: CellPoint | undefined;
  private selectionRange: { start: CellPoint; end: CellPoint } | undefined;
  private replayGeneration = 0;
  private replayTimer: number | undefined;
  private emptyReplayRepaintTimer: number | undefined;
  private replaying = false;
  private bufferedOutput: string[] = [];
  private lastReplayKind: PaneReplayKind | undefined;
  private durableRefreshGeneration = 0;
  private durableRefreshStartedAt = 0;
  private durableRefreshOutput: string[] = [];
  private durableRefreshQuietTimer: number | undefined;
  private durableRefreshFallbackTimer: number | undefined;
  private waitingForDurableRefresh = false;
  private selectionFrame: number | undefined;
  private selectionIncludeText = false;
  private resizeClaimPending = false;
  private mouseTracking: boolean | undefined;

  constructor(options: TerminalSessionOptions) {
    this.paneId = options.paneId;
    this.emit = options.emit;
    this.onActivity = options.onActivity;
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.settings = options.settings;
    this.element = document.createElement("div");
    this.element.className = "terminal-session";
    this.element.dataset.paneId = this.paneId;
    this.element.hidden = true;
    this.element.setAttribute("aria-hidden", "true");
    options.parent.appendChild(this.element);

    this.terminal = new Terminal({
      ghostty: options.ghostty,
      cols: 80,
      rows: 24,
      cursorBlink: false,
      disableStdin: true,
      emitTerminalResponses: true,
      focusOnOpen: false,
      fontFamily: '"Fira Code", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: options.settings.terminalFontSize,
      preserveScrollOnWrite: true,
      scrollback: options.settings.terminalScrollbackRows,
      theme: colorSchemeById(options.settings.colorScheme).terminal,
    });
    this.terminal.open(this.element);
    this.makeTerminalNonFocusable();
    this.linkDetector = new LinkDetector(this.terminal);
    this.linkDetector.registerProvider(new OSC8LinkProvider(this.terminal));
    this.linkDetector.registerProvider(new WrappedUrlProvider(this.terminal));
    this.keyEncoder = new SemanticKeyEncoder(options.ghostty, this.terminal);
    this.pipeline = new OutputPipeline({
      write: (data) => {
        this.terminal.write(data);
        this.linkDetector.invalidateCache();
        this.emitMouseTracking();
      },
      onOsc52: (text) => this.emit({ t: "osc52", paneId: this.paneId, text }),
      onAlternateScreen: (active) => this.emit({ t: "altScreen", paneId: this.paneId, active }),
      onMedia: (media) => this.emit({ t: "media", paneId: this.paneId, ...media }),
      onIssue: (message) => this.emit({ t: "log", level: "warn", message: `Kitty graphics: ${message}` }),
    });
    this.bindTerminalEvents();
    window.requestAnimationFrame(() => {
      if (this.disposed) return;
      this.fit();
      this.emitMetrics();
      this.connect();
    });
  }

  updateConnection(serverUrl: string, token: string): void {
    if (this.serverUrl === serverUrl && this.token === token) return;
    this.serverUrl = serverUrl;
    this.token = token;
    this.reconnect("Connection settings changed");
  }

  applySettings(settings: HostSettings): void {
    this.settings = settings;
    const scheme = colorSchemeById(settings.colorScheme);
    this.terminal.renderer?.setTheme(scheme.terminal);
    this.terminal.renderer?.setFontSize(settings.terminalFontSize);
    this.terminal.options.scrollback = settings.terminalScrollbackRows;
    window.requestAnimationFrame(() => {
      if (this.disposed) return;
      this.fit();
      this.emitMetrics();
      this.sendResize();
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    this.element.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      this.resizeClaimPending = false;
      return;
    }
    this.onActivity();
    window.requestAnimationFrame(() => {
      if (this.disposed) return;
      this.fit();
      this.redrawVisibleTerminal();
      this.emitMetrics();
      this.emitCursor();
      this.emitMouseTracking(true);
      this.sendResize(true);
    });
  }

  setViewport(widthPx: number, heightPx: number, dpr: number): void {
    this.viewportWidth = widthPx;
    this.viewportHeight = heightPx;
    this.viewportDpr = dpr;
    this.element.style.width = `${widthPx}px`;
    this.element.style.height = `${heightPx}px`;
    this.element.style.setProperty("--wmux-host-dpr", String(dpr));
    this.fit();
    this.emitMetrics();
    this.emitCursor();
    this.sendResize(this.visible);
  }

  handle(message: Exclude<ToHost, { t: "init" | "attach" | "show" | "detach" | "settings" }>): void {
    this.onActivity();
    if (message.t === "viewport") {
      this.setViewport(message.widthPx, message.heightPx, message.dpr);
      return;
    }
    if (message.t === "claimResize") {
      this.claimResizeOwnership();
      return;
    }
    if (message.t === "key") {
      this.sendKey(message);
      return;
    }
    if (message.t === "text") {
      this.sendInput(message.data);
      return;
    }
    if (message.t === "paste") {
      this.sendInput(this.bracketedPaste(message.text));
      return;
    }
    if (message.t === "scroll") {
      const wheelInput = mouseWheelInput(this.terminal, message.deltaLines, message.xPx, message.yPx);
      if (wheelInput) this.sendWheelInput(wheelInput);
      else this.terminal.scrollLines(Math.trunc(message.deltaLines));
      return;
    }
    if (message.t === "scrollToBottom") {
      this.terminal.scrollToBottom();
      return;
    }
    if (message.t === "activateLink") {
      void this.resolveLink(message);
      return;
    }
    if (message.t === "selection") {
      this.updateSelection(message);
      return;
    }
    this.scheduleSelectionEmission(true);
  }

  connect(): void {
    if (this.disposed || this.removed) return;
    this.clearReconnectTimer();
    this.closeSocket();
    this.emit({ t: "pane", paneId: this.paneId, state: "connecting" });
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.paneSocketUrl());
    } catch {
      this.scheduleReconnect("Could not open the pane connection");
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.disposed) return;
      this.reconnectAttempt = 0;
      if (this.resizeClaimPending) this.flushResizeOwnershipClaim();
      else this.sendResize(this.visible);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || this.disposed || typeof event.data !== "string") return;
      const message = decodePaneServerMessage(event.data, this.paneId);
      if (!message) {
        this.emit({ t: "log", level: "warn", message: "Ignored a malformed pane WebSocket frame" });
        return;
      }
      this.handleSocketMessage(message);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket || this.disposed) return;
      this.socket = null;
      if (this.removed || this.exited) return;
      const issue = event.code === 1000 ? "Pane connection closed" : `Pane connection lost (${event.code})`;
      this.scheduleReconnect(issue);
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) socket.close();
    });
  }

  reconnect(issue: string): void {
    if (this.disposed || this.removed) return;
    this.exited = false;
    this.reconnectAttempt = 0;
    this.emit({ t: "pane", paneId: this.paneId, state: "connecting", issue });
    this.connect();
  }

  dispose(issue?: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.replayGeneration += 1;
    if (this.replayTimer !== undefined) window.clearTimeout(this.replayTimer);
    this.clearEmptyReplayRepaintTimer();
    this.cancelDurableRefresh();
    if (this.selectionFrame !== undefined) window.cancelAnimationFrame(this.selectionFrame);
    this.clearReconnectTimer();
    this.closeSocket();
    for (const disposable of this.disposables) disposable.dispose();
    this.linkDetector.dispose();
    this.keyEncoder.dispose();
    this.terminal.dispose();
    this.element.remove();
    if (issue) this.emit({ t: "pane", paneId: this.paneId, state: "lost", issue });
  }

  snapshot(): TerminalSessionSnapshot {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.length - this.terminal.rows);
    for (let row = start; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return {
      paneId: this.paneId,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      visible: this.visible,
      connected: this.socket?.readyState === WebSocket.OPEN,
      ...(this.lastReplayKind === undefined ? {} : { replayKind: this.lastReplayKind }),
      lines,
      selection: this.readSelectionText(),
      scrollbackLength: Math.max(0, buffer.length - this.terminal.rows),
      viewportOffset: Math.max(0, this.terminal.getViewportY()),
    };
  }

  private bindTerminalEvents(): void {
    this.disposables.push(
      this.terminal.onData((data) => this.sendTerminalResponse(data)),
      this.terminal.onResize(() => {
        this.emitMetrics();
        this.emitCursor();
        this.sendResize(this.visible);
      }),
      this.terminal.onTitleChange((title) => this.emit({ t: "title", paneId: this.paneId, title })),
      this.terminal.onBell(() => this.emit({ t: "bell", paneId: this.paneId })),
      this.terminal.onCursorMove(() => this.emitCursor()),
      this.terminal.onSelectionChange(() => this.scheduleSelectionEmission(false)),
      this.terminal.onRender(() => {
        this.emitCursor();
        if (this.selectionRange) this.scheduleSelectionEmission(false);
      }),
    );
  }

  private makeTerminalNonFocusable(): void {
    this.element.tabIndex = -1;
    this.element.style.pointerEvents = "none";
    this.terminal.element?.setAttribute("tabindex", "-1");
    this.terminal.element?.setAttribute("aria-hidden", "true");
    if (this.terminal.textarea) {
      this.terminal.textarea.tabIndex = -1;
      this.terminal.textarea.readOnly = true;
      this.terminal.textarea.setAttribute("aria-hidden", "true");
      this.terminal.textarea.style.pointerEvents = "none";
      this.terminal.textarea.blur();
    }
  }

  private handleSocketMessage(message: PaneServerMessage): void {
    if (message.type === "starting") {
      this.emit({ t: "pane", paneId: this.paneId, state: "connecting", issue: message.label });
      return;
    }
    if (message.type === "ready") {
      this.exited = false;
      this.lastReplayKind = message.replayKind;
      if (shouldWaitForDurableRefresh(message)) {
        this.beginDurableRefresh();
      } else {
        this.cancelDurableRefresh();
        this.startReplay(message.replay);
      }
      this.emit({ t: "title", paneId: this.paneId, title: message.title });
      this.emit({ t: "pane", paneId: this.paneId, state: "live" });
      this.sendResize(this.visible);
      return;
    }
    if (message.type === "output") {
      if (this.bufferDurableRefreshOutput(message.data)) return;
      if (this.replaying) this.bufferedOutput.push(message.data);
      else this.pipeline.push(message.data);
      return;
    }
    if (message.type === "title") {
      this.emit({ t: "title", paneId: this.paneId, title: message.title });
      return;
    }
    if (message.type === "exit") {
      this.cancelDurableRefresh();
      this.exited = true;
      this.emit({ t: "exit", paneId: this.paneId, code: message.code });
      this.emit({
        t: "pane",
        paneId: this.paneId,
        state: "exited",
        issue: `Process exited with code ${message.code ?? "?"}`,
      });
      return;
    }
    this.cancelDurableRefresh();
    this.removed = true;
    this.emit({ t: "pane", paneId: this.paneId, state: "lost", issue: "Pane was removed" });
    this.closeSocket();
  }

  private startReplay(replay: string, onDrained?: () => void): void {
    this.replayGeneration += 1;
    const generation = this.replayGeneration;
    if (this.replayTimer !== undefined) window.clearTimeout(this.replayTimer);
    this.clearEmptyReplayRepaintTimer();
    this.replaying = true;
    this.bufferedOutput = [];
    this.pipeline.reset();
    this.selectionAnchor = undefined;
    this.selectionRange = undefined;
    this.terminal.reset();
    this.terminal.clear();
    this.emitMouseTracking();
    this.linkDetector.invalidateCache();
    const chunks: string[] = [];
    for (let offset = 0; offset < replay.length; offset += REPLAY_CHUNK_CHARACTERS) {
      chunks.push(replay.slice(offset, offset + REPLAY_CHUNK_CHARACTERS));
    }
    const drain = () => {
      if (this.disposed || generation !== this.replayGeneration) return;
      const chunk = chunks.shift();
      if (chunk !== undefined) this.pipeline.push(chunk);
      if (chunks.length > 0) {
        this.replayTimer = window.setTimeout(drain, 0);
        return;
      }
      this.replayTimer = undefined;
      this.replaying = false;
      const buffered = this.bufferedOutput;
      this.bufferedOutput = [];
      for (const output of buffered) this.pipeline.push(output);
      if (onDrained) onDrained();
      else this.scheduleEmptyReplayRepaint(generation);
      window.requestAnimationFrame(() => {
        if (this.disposed || generation !== this.replayGeneration) return;
        this.redrawVisibleTerminal();
        this.emitMetrics();
        this.emitCursor();
      });
    };
    drain();
  }

  private beginDurableRefresh(): void {
    this.cancelDurableRefresh();
    this.replayGeneration += 1;
    if (this.replayTimer !== undefined) window.clearTimeout(this.replayTimer);
    this.clearEmptyReplayRepaintTimer();
    this.replayTimer = undefined;
    this.replaying = false;
    this.bufferedOutput = [];
    this.waitingForDurableRefresh = true;
    this.durableRefreshStartedAt = Date.now();
    const generation = this.durableRefreshGeneration;
    this.durableRefreshFallbackTimer = window.setTimeout(() => {
      this.finishDurableRefresh(generation);
    }, DURABLE_REFRESH_FALLBACK_MS);
  }

  private bufferDurableRefreshOutput(data: string): boolean {
    if (!this.waitingForDurableRefresh) return false;
    this.durableRefreshOutput.push(data);
    if (this.durableRefreshQuietTimer !== undefined) window.clearTimeout(this.durableRefreshQuietTimer);
    const generation = this.durableRefreshGeneration;
    const now = Date.now();
    const settleAt = Math.max(
      this.durableRefreshStartedAt + DURABLE_REFRESH_FIRST_NUDGE_MS + DURABLE_REFRESH_QUIET_MS,
      now + DURABLE_REFRESH_QUIET_MS,
    );
    this.durableRefreshQuietTimer = window.setTimeout(
      () => {
        this.finishDurableRefresh(generation);
      },
      Math.max(0, settleAt - now),
    );
    return true;
  }

  private finishDurableRefresh(generation: number): void {
    if (!this.waitingForDurableRefresh || generation !== this.durableRefreshGeneration) return;
    const refresh = this.durableRefreshOutput.join("");
    this.clearDurableRefreshState();
    if (refresh) {
      this.startReplay(refresh, () => this.requestDurableRepaintIfBlank(generation));
      return;
    }
    this.requestDurableRepaintIfBlank(generation);
    window.requestAnimationFrame(() => {
      if (this.disposed || generation !== this.durableRefreshGeneration) return;
      this.redrawVisibleTerminal();
      this.emitMetrics();
      this.emitCursor();
    });
  }

  private cancelDurableRefresh(): void {
    this.durableRefreshGeneration += 1;
    this.clearDurableRefreshState();
  }

  private clearDurableRefreshState(): void {
    if (this.durableRefreshQuietTimer !== undefined) window.clearTimeout(this.durableRefreshQuietTimer);
    if (this.durableRefreshFallbackTimer !== undefined) window.clearTimeout(this.durableRefreshFallbackTimer);
    this.durableRefreshQuietTimer = undefined;
    this.durableRefreshFallbackTimer = undefined;
    this.durableRefreshOutput = [];
    this.waitingForDurableRefresh = false;
  }

  private redrawVisibleTerminal(): void {
    if (!this.visible) return;
    const renderer = this.terminal.renderer;
    const terminal = this.terminal.wasmTerm;
    if (!renderer || !terminal) return;
    renderer.resize(this.terminal.cols, this.terminal.rows);
    renderer.render(terminal, true, this.terminal.viewportY, this.terminal);
  }

  private requestDurableRepaintIfBlank(generation: number): void {
    if (
      this.disposed ||
      generation !== this.durableRefreshGeneration ||
      this.socket?.readyState !== WebSocket.OPEN ||
      this.terminalHasVisibleText()
    ) {
      return;
    }
    this.sendInput(REPAINT_INPUT);
  }

  private scheduleEmptyReplayRepaint(generation: number): void {
    this.clearEmptyReplayRepaintTimer();
    this.emptyReplayRepaintTimer = window.setTimeout(() => {
      this.emptyReplayRepaintTimer = undefined;
      if (
        this.disposed ||
        generation !== this.replayGeneration ||
        this.socket?.readyState !== WebSocket.OPEN ||
        this.terminalHasVisibleText()
      ) {
        return;
      }
      this.sendInput(REPAINT_INPUT);
    }, EMPTY_REPLAY_REPAINT_MS);
  }

  private clearEmptyReplayRepaintTimer(): void {
    if (this.emptyReplayRepaintTimer !== undefined) window.clearTimeout(this.emptyReplayRepaintTimer);
    this.emptyReplayRepaintTimer = undefined;
  }

  private terminalHasVisibleText(): boolean {
    const buffer = this.terminal.buffer.active;
    const start = Math.max(0, buffer.length - this.terminal.rows);
    for (let row = start; row < buffer.length; row += 1) {
      if ((buffer.getLine(row)?.translateToString(true).trim().length ?? 0) > 0) return true;
    }
    return false;
  }

  private sendKey(message: Extract<ToHost, { t: "key" }>): void {
    if (this.exited) {
      this.reconnect("Restarting pane");
      return;
    }
    const data = this.keyEncoder.encode(message);
    if (data) this.sendInput(data);
  }

  private claimResizeOwnership(): void {
    if (!this.visible) return;
    this.resizeClaimPending = true;
    this.flushResizeOwnershipClaim();
  }

  private flushResizeOwnershipClaim(): void {
    if (!this.resizeClaimPending || !this.visible || this.socket?.readyState !== WebSocket.OPEN) return;
    this.fit();
    this.sendResize(true);
    this.sendSocketMessage({ type: "input", data: "", terminalResponse: true });
    this.resizeClaimPending = false;
  }

  private sendInput(data: string): void {
    if (!data) return;
    this.terminal.clearSelection();
    this.selectionAnchor = undefined;
    this.selectionRange = undefined;
    this.terminal.scrollToBottom();
    this.sendSocketMessage({ type: "input", data, terminalResponse: false });
  }

  private sendWheelInput(data: string): void {
    this.sendSocketMessage({ type: "input", data, terminalResponse: false });
  }

  private sendTerminalResponse(data: string): void {
    if (!data) return;
    this.sendSocketMessage({ type: "input", data, terminalResponse: true });
  }

  private bracketedPaste(text: string): string {
    return this.terminal.hasBracketedPaste() ? `\x1b[200~${text}\x1b[201~` : text;
  }

  private updateSelection(message: Extract<ToHost, { t: "selection" }>): void {
    if (message.action === "clear") {
      this.selectionAnchor = undefined;
      this.selectionRange = undefined;
      this.terminal.clearSelection();
      this.scheduleSelectionEmission(false);
      return;
    }
    if (message.action === "all") {
      this.selectionRange = {
        start: { x: 0, y: 0 },
        end: { x: Math.max(0, this.terminal.cols - 1), y: Math.max(0, this.terminal.rows - 1) },
      };
      this.terminal.selectLines(0, Math.max(0, this.terminal.rows - 1));
      this.scheduleSelectionEmission(false);
      return;
    }
    const point = this.cellFromPixels(message.xPx, message.yPx);
    if (message.action === "start") {
      if (!point) return;
      this.selectionAnchor = point;
      this.selectionRange = undefined;
      this.terminal.clearSelection();
      return;
    }
    if (message.action === "word") {
      if (!point) return;
      this.selectWord(point);
      return;
    }
    if (message.action === "line") {
      if (!point) return;
      this.selectionRange = {
        start: { x: 0, y: point.y },
        end: { x: Math.max(0, this.terminal.cols - 1), y: point.y },
      };
      this.terminal.selectLines(point.y, point.y);
      this.scheduleSelectionEmission(false);
      return;
    }
    if (!point || !this.selectionAnchor) return;
    this.selectRange(this.selectionAnchor, point);
    if (message.action === "end") this.selectionAnchor = undefined;
  }

  private selectRange(first: CellPoint, second: CellPoint): void {
    const firstIndex = first.y * this.terminal.cols + first.x;
    const secondIndex = second.y * this.terminal.cols + second.x;
    const startIndex = Math.min(firstIndex, secondIndex);
    const endIndex = Math.max(firstIndex, secondIndex);
    const startRow = Math.floor(startIndex / this.terminal.cols);
    const startColumn = startIndex % this.terminal.cols;
    const endRow = Math.floor(endIndex / this.terminal.cols);
    const endColumn = endIndex % this.terminal.cols;
    this.selectionRange = {
      start: { x: startColumn, y: startRow },
      end: { x: endColumn, y: endRow },
    };
    this.terminal.select(startColumn, startRow, endIndex - startIndex + 1);
    this.scheduleSelectionEmission(false);
  }

  private selectWord(point: CellPoint): void {
    const row = this.absoluteBufferRow(point.y);
    const text = this.terminal.buffer.active.getLine(row)?.translateToString(false) ?? "";
    if (!text) return;
    const isWord = (value: string) => /[\p{L}\p{N}_]/u.test(value);
    let start = Math.min(point.x, Math.max(0, text.length - 1));
    let end = start;
    while (start > 0 && isWord(text[start - 1] ?? "")) start -= 1;
    while (end + 1 < text.length && isWord(text[end + 1] ?? "")) end += 1;
    this.selectionRange = {
      start: { x: start, y: point.y },
      end: { x: end, y: point.y },
    };
    this.terminal.select(start, point.y, Math.max(1, end - start + 1));
    this.scheduleSelectionEmission(false);
  }

  private async resolveLink(message: Extract<ToHost, { t: "activateLink" }>): Promise<void> {
    let url: string | undefined;
    const point = this.cellFromPixels(message.xPx, message.yPx);
    if (point) {
      try {
        url = (await this.linkDetector.getLinkAt(point.x, this.absoluteBufferRow(point.y)))?.text;
      } catch {
        this.emit({ t: "log", level: "warn", message: "Terminal link detection failed" });
      }
    }
    if (this.disposed) return;
    this.emit({
      t: "link",
      paneId: this.paneId,
      requestId: message.requestId,
      ...(url ? { url } : {}),
    });
  }

  private cellFromPixels(xPx: number | undefined, yPx: number | undefined): CellPoint | undefined {
    if (xPx === undefined || yPx === undefined) return undefined;
    const metrics = this.terminal.renderer?.getMetrics();
    if (!metrics?.width || !metrics.height) return undefined;
    return {
      x: clamp(Math.floor(xPx / metrics.width), 0, Math.max(0, this.terminal.cols - 1)),
      y: clamp(Math.floor(yPx / metrics.height), 0, Math.max(0, this.terminal.rows - 1)),
    };
  }

  private absoluteBufferRow(viewportRow: number): number {
    const bufferLength = this.terminal.buffer.active.length;
    const visibleTop = Math.max(0, bufferLength - this.terminal.rows - Math.round(this.terminal.getViewportY()));
    return visibleTop + viewportRow;
  }

  private fit(): void {
    const metrics = this.terminal.renderer?.getMetrics();
    const width = this.viewportWidth || this.element.clientWidth;
    const height = this.viewportHeight || this.element.clientHeight;
    if (!metrics?.width || !metrics.height || width <= 0 || height <= 0) return;
    const cols = Math.max(2, Math.floor(width / metrics.width));
    const rows = Math.max(1, Math.floor(height / metrics.height));
    if (cols !== this.terminal.cols || rows !== this.terminal.rows) {
      this.terminal.resize(cols, rows);
      this.linkDetector.invalidateCache();
    }
  }

  private emitMetrics(): void {
    const metrics = this.terminal.renderer?.getMetrics();
    if (!metrics?.width || !metrics.height) return;
    this.emit({
      t: "metrics",
      paneId: this.paneId,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      cellW: metrics.width,
      cellH: metrics.height,
    });
  }

  private emitCursor(): void {
    const cursor = this.terminal.wasmTerm?.getCursor();
    const metrics = this.terminal.renderer?.getMetrics();
    if (!cursor || !metrics?.width || !metrics.height) return;
    this.emit({
      t: "cursor",
      paneId: this.paneId,
      xPx: cursor.x * metrics.width,
      yPx: cursor.y * metrics.height,
      visible: cursor.visible,
    });
  }

  private emitMouseTracking(force = false): void {
    let active = false;
    try {
      active = this.terminal.hasMouseTracking();
    } catch {
      // Ghostty can reject mode access while it is initializing.
    }
    if (!force && active === this.mouseTracking) return;
    this.mouseTracking = active;
    this.emit({ t: "mouseTracking", paneId: this.paneId, active });
  }

  private scheduleSelectionEmission(includeText: boolean): void {
    this.selectionIncludeText ||= includeText;
    if (this.selectionFrame !== undefined) return;
    this.selectionFrame = window.requestAnimationFrame(() => {
      this.selectionFrame = undefined;
      const shouldIncludeText = this.selectionIncludeText;
      this.selectionIncludeText = false;
      this.emitSelection(shouldIncludeText);
    });
  }

  private emitSelection(includeText: boolean): void {
    const position = this.selectionRange;
    const metrics = this.terminal.renderer?.getMetrics();
    if (!position || !metrics?.width || !metrics.height) {
      this.emit({ t: "selection", paneId: this.paneId, active: false });
      return;
    }
    this.emit({
      t: "selection",
      paneId: this.paneId,
      active: true,
      startPx: {
        x: position.start.x * metrics.width,
        y: position.start.y * metrics.height,
      },
      endPx: {
        x: (position.end.x + 1) * metrics.width,
        y: (position.end.y + 1) * metrics.height,
      },
      ...(includeText ? { text: this.readSelectionText() } : {}),
    });
  }

  private readSelectionText(): string {
    const range = this.selectionRange;
    if (!range) return "";
    const lines: string[] = [];
    for (let viewportRow = range.start.y; viewportRow <= range.end.y; viewportRow += 1) {
      const line = this.terminal.buffer.active.getLine(this.absoluteBufferRow(viewportRow));
      if (!line) continue;
      const startColumn = viewportRow === range.start.y ? range.start.x : 0;
      const endColumn = viewportRow === range.end.y ? range.end.x + 1 : this.terminal.cols;
      lines.push(line.translateToString(true, startColumn, endColumn));
    }
    return lines.join("\n").replace(/\n+$/, "");
  }

  private sendResize(foreground = false): void {
    const type = foreground ? "activate" : "resize";
    this.sendSocketMessage({
      type,
      cols: Math.max(2, Math.floor(this.terminal.cols)),
      rows: Math.max(1, Math.floor(this.terminal.rows)),
      foreground,
    });
  }

  private sendSocketMessage(message: PaneClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private paneSocketUrl(): string {
    const url = new URL(this.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/ws/panes/${encodeURIComponent(this.paneId)}`;
    url.search = "";
    url.searchParams.set("token", this.token);
    url.searchParams.set("cols", String(Math.max(2, this.terminal.cols)));
    url.searchParams.set("rows", String(Math.max(1, this.terminal.rows)));
    return url.toString();
  }

  private scheduleReconnect(issue: string): void {
    if (this.disposed || this.removed || this.exited || this.reconnectTimer !== undefined) return;
    this.emit({ t: "pane", paneId: this.paneId, state: "lost", issue });
    const delay = Math.min(RECONNECT_MAX_MS, 400 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "wmux host reconnect");
  }
}

const decodePaneServerMessage = (value: string, paneId: string): PaneServerMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!record(parsed) || typeof parsed.type !== "string" || parsed.paneId !== paneId) return null;
  if (
    parsed.type === "starting" &&
    typeof parsed.phase === "string" &&
    paneStartupPhases.has(parsed.phase) &&
    typeof parsed.label === "string"
  ) {
    return {
      type: "starting",
      paneId,
      phase: parsed.phase as Extract<PaneServerMessage, { type: "starting" }>["phase"],
      label: parsed.label,
    };
  }
  if (parsed.type === "output" && typeof parsed.data === "string") {
    return {
      type: "output",
      paneId,
      data: parsed.data,
      ...(Number.isInteger(parsed.inputSequence) ? { inputSequence: parsed.inputSequence as number } : {}),
    };
  }
  if (parsed.type === "title" && typeof parsed.title === "string") {
    return { type: "title", paneId, title: parsed.title };
  }
  if (parsed.type === "exit" && (parsed.code === null || Number.isInteger(parsed.code))) {
    return { type: "exit", paneId, code: parsed.code as number | null };
  }
  if (parsed.type === "removed") return { type: "removed", paneId };
  if (
    parsed.type === "ready" &&
    Number.isInteger(parsed.pid) &&
    typeof parsed.title === "string" &&
    (parsed.status === "idle" || parsed.status === "running" || parsed.status === "exited") &&
    typeof parsed.replay === "string" &&
    (parsed.replayKind === "raw" || parsed.replayKind === "checkpoint")
  ) {
    return {
      type: "ready",
      paneId,
      pid: parsed.pid as number,
      title: parsed.title,
      status: parsed.status,
      replay: parsed.replay,
      replayKind: parsed.replayKind,
      ...(typeof parsed.resizeOwner === "boolean" ? { resizeOwner: parsed.resizeOwner } : {}),
      ...(typeof parsed.outputOnly === "boolean" ? { outputOnly: parsed.outputOnly } : {}),
      ...(parsed.waitForRefresh === true ? { waitForRefresh: true } : {}),
    };
  }
  return null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const paneStartupPhases = new Set([
  "connecting",
  "checking-agent",
  "staging-helpers",
  "starting-generation",
  "creating-session",
  "replaying",
]);

const shouldWaitForDurableRefresh = (message: Extract<PaneServerMessage, { type: "ready" }>): boolean =>
  message.waitForRefresh === true && message.replayKind === "raw" && message.replay === "";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);
