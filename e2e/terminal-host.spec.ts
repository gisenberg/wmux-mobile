import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";

import type { PaneClientMessage, PaneServerMessage } from "../protocol/wmux";
import type { HostSettings, ToHost, ToNative } from "../src/terminal/bridge";
import type { TerminalPoolSnapshot } from "../src/terminal/host/terminal-pool";

const settings: HostSettings = {
  terminalFontSize: 14,
  terminalScrollbackRows: 5_000,
  colorScheme: "wmux",
  tuiFrameRate: 30,
  terminalScrollMode: "batched",
};

interface MockPaneSocket {
  route: WebSocketRoute;
  received: PaneClientMessage[];
  url: string;
}

interface Harness {
  dispatch: (message: ToHost) => Promise<void>;
  messages: () => Promise<ToNative[]>;
  snapshot: () => Promise<TerminalPoolSnapshot>;
  socket: (paneId: string) => Promise<MockPaneSocket>;
  send: (paneId: string, message: PaneServerMessage) => Promise<void>;
}

let viteServer: ViteDevServer;
let hostUrl: string;

test.beforeAll(async () => {
  viteServer = await createServer({
    configFile: path.resolve("src/terminal/host/vite.config.mts"),
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite host server did not expose a TCP port");
  hostUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await viteServer.close();
});

test("owns pane sockets and preserves raw and checkpoint replay ordering", async ({ page }) => {
  const harness = await openHarness(page);
  await initializePane(harness, "pane-raw", 640, 360);
  await harness.send("pane-raw", ready("pane-raw", "raw", "\x1b[2J\x1b[Hraw replay\r\n"));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-raw")?.lines.join("\n"),
    )
    .toContain("raw replay");

  const rawSocket = await harness.socket("pane-raw");
  await expect
    .poll(() => rawSocket.received.find((message) => message.type === "activate"))
    .toMatchObject({ type: "activate", foreground: true });

  await harness.send("pane-raw", {
    type: "output",
    paneId: "pane-raw",
    data: "live output\r\n",
  });
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-raw")?.lines.join("\n"),
    )
    .toContain("live output");

  await harness.dispatch({
    t: "key",
    paneId: "pane-raw",
    key: "ArrowUp",
    code: "ArrowUp",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });
  await expect.poll(() => inputPayloads(rawSocket)).toContain("\x1b[A");

  await harness.send("pane-raw", { type: "output", paneId: "pane-raw", data: "\x1b[?1h" });
  await harness.dispatch({
    t: "key",
    paneId: "pane-raw",
    key: "ArrowUp",
    code: "ArrowUp",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });
  await expect.poll(() => inputPayloads(rawSocket)).toContain("\x1bOA");

  await harness.dispatch({ t: "text", paneId: "pane-raw", data: "λ" });
  await harness.send("pane-raw", { type: "output", paneId: "pane-raw", data: "\x1b[?2004h" });
  await harness.dispatch({ t: "paste", paneId: "pane-raw", text: "two\nlines" });
  await expect.poll(() => inputPayloads(rawSocket)).toContain("λ");
  await expect.poll(() => inputPayloads(rawSocket)).toContain("\x1b[200~two\nlines\x1b[201~");

  await harness.dispatch({ t: "attach", paneId: "pane-checkpoint" });
  await harness.dispatch({ t: "show", paneId: "pane-checkpoint" });
  await harness.dispatch({ t: "viewport", paneId: "pane-checkpoint", widthPx: 640, heightPx: 360, dpr: 1 });
  await harness.socket("pane-checkpoint");
  await harness.send("pane-checkpoint", ready("pane-checkpoint", "checkpoint", "\x1b[2J\x1b[Hcheckpoint replay\r\n"));
  await expect
    .poll(async () => {
      const pane = (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-checkpoint");
      return `${pane?.replayKind}:${pane?.lines.join("\n")}`;
    })
    .toContain("checkpoint:checkpoint replay");
});

test("emits low-frequency control signals without bridging terminal output", async ({ page }) => {
  const harness = await openHarness(page);
  await initializePane(harness, "pane-signals", 560, 320);
  await harness.send("pane-signals", ready("pane-signals", "raw", "select this text\r\n"));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-signals")?.lines.join("\n"),
    )
    .toContain("select this text");

  await harness.dispatch({ t: "selection", paneId: "pane-signals", action: "all" });
  await expect
    .poll(
      async () => (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-signals")?.selection,
    )
    .toContain("select this text");
  await harness.dispatch({ t: "copySelection", paneId: "pane-signals" });
  await expect
    .poll(async () => {
      const message = (await harness.messages()).findLast(
        (candidate): candidate is Extract<ToNative, { t: "selection" }> =>
          candidate.t === "selection" && candidate.active && typeof candidate.text === "string",
      );
      return message?.text;
    })
    .toContain("select this text");

  const clipboardText = "native clipboard";
  await harness.send("pane-signals", {
    type: "output",
    paneId: "pane-signals",
    data: `\x1b]52;c;${Buffer.from(clipboardText).toString("base64")}\x07`,
  });
  await expect
    .poll(async () => (await harness.messages()).find((message) => message.t === "osc52"))
    .toMatchObject({ t: "osc52", paneId: "pane-signals", text: clipboardText });

  await harness.send("pane-signals", {
    type: "output",
    paneId: "pane-signals",
    data: "\x1b[?1049h\x1b]0;alternate title\x07\x07",
  });
  await expect
    .poll(async () => (await harness.messages()).findLast((message) => message.t === "altScreen"))
    .toMatchObject({ t: "altScreen", active: true });
  await expect
    .poll(async () => (await harness.messages()).findLast((message) => message.t === "title"))
    .toMatchObject({ t: "title", title: "alternate title" });
  await expect.poll(async () => (await harness.messages()).some((message) => message.t === "bell")).toBe(true);

  await harness.send("pane-signals", {
    type: "output",
    paneId: "pane-signals",
    data: "\x1b[?1049l",
  });
  await expect
    .poll(async () => (await harness.messages()).findLast((message) => message.t === "altScreen"))
    .toMatchObject({ t: "altScreen", active: false });

  const redPixelPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
  await harness.send("pane-signals", {
    type: "output",
    paneId: "pane-signals",
    data: `\x1b_Ga=T,f=100,i=7;${redPixelPng}\x1b\\`,
  });
  await expect
    .poll(async () => (await harness.messages()).find((message) => message.t === "media"))
    .toMatchObject({ t: "media", paneId: "pane-signals", mimeType: "image/png" });

  const bridged = await harness.messages();
  expect(bridged.some((message) => (message as { t: string }).t === "output")).toBe(false);
});

test("keeps exactly three terminals and evicts the least recently used background pane", async ({ page }) => {
  const harness = await openHarness(page);
  await harness.dispatch({ t: "init", serverUrl: "https://wmux.invalid", token: "test-token", settings });
  for (const paneId of ["pane-1", "pane-2", "pane-3"]) {
    await harness.dispatch({ t: "attach", paneId });
    await harness.socket(paneId);
  }
  await harness.dispatch({ t: "show", paneId: "pane-3" });
  await harness.dispatch({ t: "attach", paneId: "pane-4" });
  await harness.socket("pane-4");

  await expect
    .poll(async () => (await harness.snapshot()).sessions.map((session) => session.paneId).sort())
    .toEqual(["pane-2", "pane-3", "pane-4"]);
  await expect
    .poll(async () =>
      (await harness.messages()).find(
        (message) => message.t === "pane" && message.paneId === "pane-1" && message.state === "lost",
      ),
    )
    .toMatchObject({ issue: "Evicted from the local terminal pool" });
});

test("renders the pinned wmux VT fixture deterministically", async ({ page }) => {
  const harness = await openHarness(page);
  await initializePane(harness, "pane-golden", 640, 360);
  const fixture = [
    "\x1b[2J\x1b[H",
    "\x1b[1;38;2;244;211;94mwmux terminal parity\x1b[0m\r\n",
    "\x1b[38;2;80;151;255m╭────────────────────────────╮\x1b[0m\r\n",
    "\x1b[38;2;80;151;255m│\x1b[0m raw + checkpoint + Unicode \x1b[38;2;80;151;255m│\x1b[0m\r\n",
    "\x1b[38;2;80;151;255m╰────────────────────────────╯\x1b[0m\r\n",
    "\x1b[32m✓\x1b[0m λ العربية देवनागरी emoji: 🧭\r\n",
    "\x1b[2mselection, color, box drawing, ligatures: -> != ===\x1b[0m",
  ].join("");
  await harness.send("pane-golden", ready("pane-golden", "checkpoint", fixture));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === "pane-golden")?.lines.join("\n"),
    )
    .toContain("wmux terminal parity");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('.terminal-session[data-pane-id="pane-golden"]')).toHaveScreenshot(
    "wmux-terminal-fixture.png",
  );
});

const openHarness = async (page: Page): Promise<Harness> => {
  const sockets = new Map<string, MockPaneSocket>();
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __wmuxNativeMessages: ToNative[];
      ReactNativeWebView: { postMessage: (message: string) => void };
    };
    target.__wmuxNativeMessages = [];
    target.ReactNativeWebView = {
      postMessage(message) {
        target.__wmuxNativeMessages.push(JSON.parse(message) as ToNative);
      },
    };
  });
  await page.routeWebSocket(/\/ws\/panes\//, (route) => {
    const url = new URL(route.url());
    const paneId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const socket: MockPaneSocket = { route, received: [], url: route.url() };
    sockets.set(paneId, socket);
    route.onMessage((message) => {
      if (typeof message !== "string") return;
      socket.received.push(JSON.parse(message) as PaneClientMessage);
    });
  });
  await page.goto(hostUrl);
  await expect.poll(async () => (await nativeMessages(page)).some((message) => message.t === "ready")).toBe(true);

  return {
    dispatch: async (message) => {
      await page.evaluate((value) => {
        const target = window as typeof window & { __wmuxHost?: { dispatch: (input: unknown) => void } };
        target.__wmuxHost?.dispatch(value);
      }, message);
    },
    messages: () => nativeMessages(page),
    snapshot: () =>
      page.evaluate(() => {
        const target = window as typeof window & {
          __wmuxHost?: { snapshot?: () => TerminalPoolSnapshot };
        };
        const snapshot = target.__wmuxHost?.snapshot?.();
        if (!snapshot) throw new Error("Development terminal snapshot is unavailable");
        return snapshot;
      }),
    socket: async (paneId) => {
      await expect.poll(() => sockets.get(paneId)).toBeTruthy();
      const socket = sockets.get(paneId);
      if (!socket) throw new Error(`Pane socket ${paneId} was not created`);
      return socket;
    },
    send: async (paneId, message) => {
      const socket = sockets.get(paneId);
      if (!socket) throw new Error(`Pane socket ${paneId} was not created`);
      socket.route.send(JSON.stringify(message));
    },
  };
};

const initializePane = async (harness: Harness, paneId: string, widthPx: number, heightPx: number): Promise<void> => {
  await harness.dispatch({ t: "init", serverUrl: "https://wmux.invalid", token: "test-token", settings });
  await harness.dispatch({ t: "attach", paneId });
  await harness.dispatch({ t: "show", paneId });
  await harness.dispatch({ t: "viewport", paneId, widthPx, heightPx, dpr: 1 });
  await harness.socket(paneId);
};

const ready = (paneId: string, replayKind: "raw" | "checkpoint", replay: string): PaneServerMessage => ({
  type: "ready",
  paneId,
  pid: 100,
  title: `${paneId} shell`,
  status: "running",
  replay,
  replayKind,
});

const inputPayloads = (socket: MockPaneSocket): string[] =>
  socket.received
    .filter((message): message is Extract<PaneClientMessage, { type: "input" }> => message.type === "input")
    .map((message) => message.data);

const nativeMessages = (page: Page): Promise<ToNative[]> =>
  page.evaluate(() => {
    const target = window as typeof window & { __wmuxNativeMessages?: ToNative[] };
    return target.__wmuxNativeMessages ?? [];
  });
