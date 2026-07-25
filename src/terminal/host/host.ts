import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/600.css";
import { Ghostty } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

import { decodeToHost, encodeBridgeMessage, type ToNative } from "../bridge";
import { TerminalPool, type TerminalPoolSnapshot } from "./terminal-pool";
import "./styles.css";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
    __wmuxHost?: {
      dispatch: (message: unknown) => void;
      snapshot?: () => TerminalPoolSnapshot;
    };
  }
}

const root = document.querySelector<HTMLElement>("#terminal-pool");
if (!root) throw new Error("Terminal host root is missing");

let pool: TerminalPool | undefined;

const emit = (message: ToNative): void => {
  const safeMessage = message.t === "log" ? { ...message, message: redactSensitive(message.message) } : message;
  const encoded = encodeBridgeMessage(safeMessage);
  window.dispatchEvent(new CustomEvent<ToNative>("wmux:to-native", { detail: safeMessage }));
  window.ReactNativeWebView?.postMessage(encoded);
};

const dispatch = (input: unknown): void => {
  const decoded = decodeToHost(input);
  if (!decoded.ok) {
    emit({ t: "log", level: "warn", message: `Ignored native bridge message: ${decoded.issue}` });
    return;
  }
  if (!pool) {
    emit({ t: "log", level: "error", message: "Terminal host is not ready" });
    return;
  }
  try {
    pool.receive(decoded.value);
  } catch (error: unknown) {
    emit({
      t: "log",
      level: "error",
      message: error instanceof Error ? error.message : "Terminal host message failed",
    });
  }
};

const onMessage = (event: MessageEvent<unknown>): void => dispatch(event.data);
window.addEventListener("message", onMessage);
document.addEventListener("message", onMessage as EventListener);

window.addEventListener("error", (event) => {
  emit({ t: "log", level: "error", message: event.message || "Terminal host error" });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  emit({
    t: "log",
    level: "error",
    message: reason instanceof Error ? reason.message : "Terminal host promise rejected",
  });
});
window.addEventListener("pagehide", () => pool?.dispose(), { once: true });

const start = async (): Promise<void> => {
  const ghostty = await Ghostty.load(ghosttyWasmUrl);
  pool = new TerminalPool({ ghostty, parent: root, emit });
  window.__wmuxHost = {
    dispatch,
    ...(import.meta.env.DEV ? { snapshot: () => pool?.snapshot() ?? { sessions: [] } } : {}),
  };
  emit({ t: "ready" });
};

void start().catch((error: unknown) => {
  emit({
    t: "log",
    level: "error",
    message: error instanceof Error ? error.message : "Terminal host failed to initialize",
  });
});

const redactSensitive = (value: string): string =>
  value
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]");
