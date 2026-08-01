import { TERMINAL_COLOR_SCHEME_IDS, type TerminalColorSchemeId } from "../../protocol/wmux";

export { TERMINAL_COLOR_SCHEME_IDS };
export type { TerminalColorSchemeId };

export const TERMINAL_POOL_CAPACITY = 3;

export interface HostSettings {
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalScrollbackRows: number;
  colorScheme: TerminalColorSchemeId;
  tuiFrameRate: 15 | 30 | 60;
  terminalScrollMode: "batched" | "immediate";
}

export interface Point {
  x: number;
  y: number;
}

export type ToHost =
  | { t: "init"; serverUrl: string; token: string; settings: HostSettings }
  | { t: "attach"; paneId: string }
  | { t: "show"; paneId: string }
  | { t: "detach"; paneId: string }
  | { t: "viewport"; paneId: string; widthPx: number; heightPx: number; dpr: number }
  | { t: "claimResize"; paneId: string }
  | {
      t: "key";
      paneId: string;
      key: string;
      code: string;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  | { t: "text"; paneId: string; data: string }
  | { t: "paste"; paneId: string; text: string }
  | { t: "scroll"; paneId: string; deltaLines: number; xPx: number; yPx: number }
  | { t: "scrollToBottom"; paneId: string }
  | { t: "activateLink"; paneId: string; requestId: string; xPx: number; yPx: number }
  | {
      t: "selection";
      paneId: string;
      action: "start" | "move" | "end" | "clear" | "word" | "line" | "all";
      xPx?: number;
      yPx?: number;
    }
  | { t: "copySelection"; paneId: string }
  | { t: "settings"; settings: HostSettings };

export type ToNative =
  | { t: "ready" }
  | { t: "pane"; paneId: string; state: "connecting" | "live" | "lost" | "exited"; issue?: string }
  | { t: "metrics"; paneId: string; cols: number; rows: number; cellW: number; cellH: number }
  | { t: "title"; paneId: string; title: string }
  | { t: "bell"; paneId: string }
  | { t: "osc52"; paneId: string; text: string }
  | { t: "altScreen"; paneId: string; active: boolean }
  | { t: "mouseTracking"; paneId: string; active: boolean }
  | { t: "cursor"; paneId: string; xPx: number; yPx: number; visible: boolean }
  | { t: "selection"; paneId: string; active: boolean; startPx?: Point; endPx?: Point; text?: string }
  | { t: "link"; paneId: string; requestId: string; url?: string }
  | { t: "media"; paneId: string; name: string; mimeType: string; dataUrl: string }
  | { t: "exit"; paneId: string; code: number | null }
  | { t: "log"; level: "debug" | "warn" | "error"; message: string };

export type BridgeDecodeResult<T> = { ok: true; value: T } | { ok: false; issue: string };

const colorSchemeIds = new Set<string>(TERMINAL_COLOR_SCHEME_IDS);
const toHostTypes = new Set([
  "init",
  "attach",
  "show",
  "detach",
  "viewport",
  "claimResize",
  "key",
  "text",
  "paste",
  "scroll",
  "scrollToBottom",
  "activateLink",
  "selection",
  "copySelection",
  "settings",
]);
const selectionActions = new Set(["start", "move", "end", "clear", "word", "line", "all"]);

export const decodeToHost = (input: unknown): BridgeDecodeResult<ToHost> => {
  const parsed = parseBridgeInput(input);
  if (!parsed.ok) return parsed;
  const message = parsed.value;
  if (!isRecord(message) || typeof message.t !== "string" || !toHostTypes.has(message.t)) {
    return invalid("unknown message type");
  }

  if (message.t === "init") {
    if (typeof message.serverUrl !== "string" || typeof message.token !== "string") {
      return invalid("init requires serverUrl and token");
    }
    const settings = decodeHostSettings(message.settings);
    if (!settings.ok) return settings;
    return valid({ t: "init", serverUrl: message.serverUrl, token: message.token, settings: settings.value });
  }

  if (message.t === "settings") {
    const settings = decodeHostSettings(message.settings);
    return settings.ok ? valid({ t: "settings", settings: settings.value }) : settings;
  }

  if (typeof message.paneId !== "string" || !message.paneId) {
    return invalid(`${message.t} requires paneId`);
  }
  const paneId = message.paneId;

  if (
    message.t === "attach" ||
    message.t === "show" ||
    message.t === "detach" ||
    message.t === "claimResize" ||
    message.t === "scrollToBottom"
  ) {
    return valid({ t: message.t, paneId });
  }
  if (message.t === "viewport") {
    if (!positiveNumber(message.widthPx) || !positiveNumber(message.heightPx) || !positiveNumber(message.dpr)) {
      return invalid("viewport dimensions must be positive finite numbers");
    }
    return valid({
      t: "viewport",
      paneId,
      widthPx: message.widthPx,
      heightPx: message.heightPx,
      dpr: message.dpr,
    });
  }
  if (message.t === "key") {
    if (
      typeof message.key !== "string" ||
      typeof message.code !== "string" ||
      typeof message.ctrl !== "boolean" ||
      typeof message.alt !== "boolean" ||
      typeof message.shift !== "boolean" ||
      typeof message.meta !== "boolean"
    ) {
      return invalid("key message is malformed");
    }
    return valid({
      t: "key",
      paneId,
      key: message.key,
      code: message.code,
      ctrl: message.ctrl,
      alt: message.alt,
      shift: message.shift,
      meta: message.meta,
    });
  }
  if (message.t === "text") {
    return typeof message.data === "string"
      ? valid({ t: "text", paneId, data: message.data })
      : invalid("text data must be a string");
  }
  if (message.t === "paste") {
    return typeof message.text === "string"
      ? valid({ t: "paste", paneId, text: message.text })
      : invalid("paste text must be a string");
  }
  if (message.t === "scroll") {
    return finiteNumber(message.deltaLines) && nonnegativeNumber(message.xPx) && nonnegativeNumber(message.yPx)
      ? valid({ t: "scroll", paneId, deltaLines: message.deltaLines, xPx: message.xPx, yPx: message.yPx })
      : invalid("scroll deltaLines and coordinates must be finite");
  }
  if (message.t === "activateLink") {
    if (
      typeof message.requestId !== "string" ||
      !message.requestId ||
      !nonnegativeNumber(message.xPx) ||
      !nonnegativeNumber(message.yPx)
    ) {
      return invalid("activateLink message is malformed");
    }
    return valid({
      t: "activateLink",
      paneId,
      requestId: message.requestId,
      xPx: message.xPx,
      yPx: message.yPx,
    });
  }
  if (message.t === "selection") {
    if (typeof message.action !== "string" || !selectionActions.has(message.action)) {
      return invalid("selection action is invalid");
    }
    if (
      (message.xPx !== undefined && !finiteNumber(message.xPx)) ||
      (message.yPx !== undefined && !finiteNumber(message.yPx))
    ) {
      return invalid("selection coordinates must be finite");
    }
    return valid({
      t: "selection",
      paneId,
      action: message.action as Extract<ToHost, { t: "selection" }>["action"],
      ...(message.xPx === undefined ? {} : { xPx: message.xPx }),
      ...(message.yPx === undefined ? {} : { yPx: message.yPx }),
    });
  }
  return valid({ t: "copySelection", paneId });
};

export const decodeToNative = (input: unknown): BridgeDecodeResult<ToNative> => {
  const parsed = parseBridgeInput(input);
  if (!parsed.ok) return parsed;
  const message = parsed.value;
  if (!isRecord(message) || typeof message.t !== "string") return invalid("native message must have a type");

  if (message.t === "ready") return valid({ t: "ready" });
  if (message.t === "log") {
    if (
      (message.level !== "debug" && message.level !== "warn" && message.level !== "error") ||
      typeof message.message !== "string"
    ) {
      return invalid("log message is malformed");
    }
    return valid({ t: "log", level: message.level, message: message.message });
  }
  if (typeof message.paneId !== "string" || !message.paneId) return invalid(`${message.t} requires paneId`);
  const paneId = message.paneId;

  if (message.t === "pane") {
    if (
      message.state !== "connecting" &&
      message.state !== "live" &&
      message.state !== "lost" &&
      message.state !== "exited"
    ) {
      return invalid("pane state is invalid");
    }
    if (message.issue !== undefined && typeof message.issue !== "string") return invalid("pane issue must be a string");
    return valid({
      t: "pane",
      paneId,
      state: message.state,
      ...(message.issue === undefined ? {} : { issue: message.issue }),
    });
  }
  if (message.t === "metrics") {
    if (
      !positiveInteger(message.cols) ||
      !positiveInteger(message.rows) ||
      !positiveNumber(message.cellW) ||
      !positiveNumber(message.cellH)
    ) {
      return invalid("metrics message is malformed");
    }
    return valid({
      t: "metrics",
      paneId,
      cols: message.cols,
      rows: message.rows,
      cellW: message.cellW,
      cellH: message.cellH,
    });
  }
  if (message.t === "title") {
    return typeof message.title === "string"
      ? valid({ t: "title", paneId, title: message.title })
      : invalid("title must be a string");
  }
  if (message.t === "bell") return valid({ t: "bell", paneId });
  if (message.t === "osc52") {
    return typeof message.text === "string"
      ? valid({ t: "osc52", paneId, text: message.text })
      : invalid("osc52 text must be a string");
  }
  if (message.t === "altScreen") {
    return typeof message.active === "boolean"
      ? valid({ t: "altScreen", paneId, active: message.active })
      : invalid("altScreen active must be boolean");
  }
  if (message.t === "mouseTracking") {
    return typeof message.active === "boolean"
      ? valid({ t: "mouseTracking", paneId, active: message.active })
      : invalid("mouseTracking active must be boolean");
  }
  if (message.t === "cursor") {
    if (!finiteNumber(message.xPx) || !finiteNumber(message.yPx) || typeof message.visible !== "boolean") {
      return invalid("cursor message is malformed");
    }
    return valid({
      t: "cursor",
      paneId,
      xPx: message.xPx,
      yPx: message.yPx,
      visible: message.visible,
    });
  }
  if (message.t === "selection") {
    if (typeof message.active !== "boolean") return invalid("selection active must be boolean");
    const startPx = decodePoint(message.startPx);
    const endPx = decodePoint(message.endPx);
    if (message.startPx !== undefined && !startPx) return invalid("selection startPx is invalid");
    if (message.endPx !== undefined && !endPx) return invalid("selection endPx is invalid");
    if (message.text !== undefined && typeof message.text !== "string")
      return invalid("selection text must be a string");
    return valid({
      t: "selection",
      paneId,
      active: message.active,
      ...(startPx ? { startPx } : {}),
      ...(endPx ? { endPx } : {}),
      ...(message.text === undefined ? {} : { text: message.text }),
    });
  }
  if (message.t === "link") {
    if (
      typeof message.requestId !== "string" ||
      !message.requestId ||
      (message.url !== undefined && typeof message.url !== "string")
    ) {
      return invalid("link message is malformed");
    }
    return valid({
      t: "link",
      paneId,
      requestId: message.requestId,
      ...(message.url === undefined ? {} : { url: message.url }),
    });
  }
  if (message.t === "media") {
    if (
      typeof message.name !== "string" ||
      typeof message.mimeType !== "string" ||
      typeof message.dataUrl !== "string"
    ) {
      return invalid("media message is malformed");
    }
    return valid({
      t: "media",
      paneId,
      name: message.name,
      mimeType: message.mimeType,
      dataUrl: message.dataUrl,
    });
  }
  if (message.t === "exit") {
    return message.code === null || Number.isInteger(message.code)
      ? valid({ t: "exit", paneId, code: message.code as number | null })
      : invalid("exit code must be an integer or null");
  }
  return invalid("unknown native message type");
};

export const encodeBridgeMessage = (message: ToHost | ToNative): string => JSON.stringify(message);

const decodeHostSettings = (input: unknown): BridgeDecodeResult<HostSettings> => {
  if (!isRecord(input)) return invalid("settings must be an object");
  if (
    typeof input.terminalFontFamily !== "string" ||
    !input.terminalFontFamily.trim() ||
    !positiveNumber(input.terminalFontSize) ||
    !positiveInteger(input.terminalScrollbackRows) ||
    typeof input.colorScheme !== "string" ||
    !colorSchemeIds.has(input.colorScheme) ||
    (input.tuiFrameRate !== 15 && input.tuiFrameRate !== 30 && input.tuiFrameRate !== 60) ||
    (input.terminalScrollMode !== "batched" && input.terminalScrollMode !== "immediate")
  ) {
    return invalid("settings are malformed");
  }
  return valid({
    terminalFontFamily: input.terminalFontFamily,
    terminalFontSize: input.terminalFontSize,
    terminalScrollbackRows: input.terminalScrollbackRows,
    colorScheme: input.colorScheme as TerminalColorSchemeId,
    tuiFrameRate: input.tuiFrameRate,
    terminalScrollMode: input.terminalScrollMode,
  });
};

const parseBridgeInput = (input: unknown): BridgeDecodeResult<unknown> => {
  if (typeof input !== "string") return valid(input);
  try {
    return valid(JSON.parse(input) as unknown);
  } catch {
    return invalid("message is not valid JSON");
  }
};

const decodePoint = (input: unknown): Point | undefined =>
  isRecord(input) && finiteNumber(input.x) && finiteNumber(input.y) ? { x: input.x, y: input.y } : undefined;

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const finiteNumber = (input: unknown): input is number => typeof input === "number" && Number.isFinite(input);
const nonnegativeNumber = (input: unknown): input is number => finiteNumber(input) && input >= 0;
const positiveNumber = (input: unknown): input is number => finiteNumber(input) && input > 0;
const positiveInteger = (input: unknown): input is number => Number.isInteger(input) && Number(input) > 0;
const valid = <T>(value: T): BridgeDecodeResult<T> => ({ ok: true, value });
const invalid = (issue: string): BridgeDecodeResult<never> => ({ ok: false, issue });
