import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";

import { DEFAULT_TERMINAL_FONT_FAMILY, type PaneClientMessage, type PaneServerMessage } from "../protocol/wmux";
import type { HostSettings, ToHost, ToNative } from "../src/terminal/bridge";
import type { TerminalPoolSnapshot } from "../src/terminal/host/terminal-pool";

const settings: HostSettings = {
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
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

test("loads bundled terminal fonts before accepting sessions", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __releaseTerminalFonts?: () => void;
      __terminalFontLoadRequests?: { family: string; weight: string }[];
      __wmuxNativeMessages: ToNative[];
      ReactNativeWebView: { postMessage: (message: string) => void };
    };
    target.__wmuxNativeMessages = [];
    target.ReactNativeWebView = {
      postMessage(message) {
        target.__wmuxNativeMessages.push(JSON.parse(message) as ToNative);
      },
    };

    const originalLoad = FontFace.prototype.load;
    const gate = new Promise<void>((resolve) => {
      target.__releaseTerminalFonts = resolve;
    });
    target.__terminalFontLoadRequests = [];
    Object.defineProperty(FontFace.prototype, "load", {
      configurable: true,
      value: function (this: FontFace) {
        target.__terminalFontLoadRequests?.push({ family: this.family, weight: this.weight });
        return gate.then(() => originalLoad.call(this));
      },
    });
  });

  await page.goto(hostUrl);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const target = window as typeof window & {
          __terminalFontLoadRequests?: { family: string; weight: string }[];
        };
        return target.__terminalFontLoadRequests?.length ?? 0;
      }),
    )
    .toBe(6);
  expect((await nativeMessages(page)).some((message) => message.t === "ready")).toBe(false);
  await page.evaluate(() => {
    const target = window as typeof window & { __releaseTerminalFonts?: () => void };
    target.__releaseTerminalFonts?.();
  });
  await expect.poll(async () => (await nativeMessages(page)).some((message) => message.t === "ready")).toBe(true);
  expect(
    await page.evaluate(() => {
      const target = window as typeof window & {
        __terminalFontLoadRequests?: { family: string; weight: string }[];
      };
      return target.__terminalFontLoadRequests;
    }),
  ).toEqual([
    { family: '"Fira Code"', weight: "400" },
    { family: '"Fira Code"', weight: "600" },
    { family: '"MesloLGM Nerd Font"', weight: "400" },
    { family: '"MesloLGM Nerd Font"', weight: "700" },
    { family: '"MesloLGM Nerd Font"', weight: "400" },
    { family: '"MesloLGM Nerd Font"', weight: "700" },
  ]);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(
    await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family.includes("Fira Code") && face.status === "loaded")
        .map((face) => face.weight)
        .sort(),
    ),
  ).toEqual(["400", "600"]);
  expect(
    await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family.includes("MesloLGM Nerd Font") && face.status === "loaded")
        .map((face) => ({ style: face.style, weight: face.weight })),
    ),
  ).toEqual([
    { style: "normal", weight: "400" },
    { style: "normal", weight: "700" },
    { style: "italic", weight: "400" },
    { style: "italic", weight: "700" },
  ]);
});

test("uses the server-selected bundled Nerd Font and updates existing sessions", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-font";
  const mesloSettings: HostSettings = {
    ...settings,
    terminalFontFamily: '"MesloLGM Nerd Font"',
  };
  await harness.dispatch({
    t: "init",
    serverUrl: "https://wmux.invalid",
    token: "test-token",
    settings: mesloSettings,
  });
  await harness.dispatch({ t: "attach", paneId });
  await expect
    .poll(async () => (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.fontFamily)
    .toContain("MesloLGM Nerd Font");

  await harness.dispatch({ t: "settings", settings });
  await expect
    .poll(async () => (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.fontFamily)
    .toBe(DEFAULT_TERMINAL_FONT_FAMILY);
});

test("owns pane sockets and preserves raw and checkpoint replay ordering", async ({ page }) => {
  const harness = await openHarness(page);
  await initializePane(harness, "pane-raw", 640, 360);
  await harness.send("pane-raw", {
    type: "starting",
    paneId: "pane-raw",
    phase: "replaying",
    label: "Restoring terminal…",
  });
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

  await harness.dispatch({
    t: "key",
    paneId: "pane-raw",
    key: "Enter",
    code: "Enter",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });
  await expect.poll(() => inputPayloads(rawSocket)).toContain("\r");

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

test("claims PTY resize ownership without sending terminal bytes", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-resize-claim";
  await initializePane(harness, paneId, 390, 420);
  const socket = await harness.socket(paneId);
  socket.received.splice(0);

  await harness.dispatch({ t: "claimResize", paneId });

  await expect
    .poll(() =>
      socket.received.find(
        (message): message is Extract<PaneClientMessage, { type: "input" }> =>
          message.type === "input" && message.data === "",
      ),
    )
    .toMatchObject({ type: "input", data: "", terminalResponse: true });
  const claimIndex = socket.received.findIndex((message) => message.type === "input" && message.data === "");
  expect(socket.received[claimIndex - 1]).toEqual({
    type: "activate",
    cols: expect.any(Number),
    rows: expect.any(Number),
    foreground: true,
  });
  expect(inputPayloads(socket)).toEqual([""]);
});

test("routes native scroll as DEC wheel input only while terminal mouse tracking is active", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-mouse-wheel";
  await initializePane(harness, paneId, 640, 360);
  const socket = await harness.socket(paneId);
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "metrics" && message.paneId === paneId),
    )
    .toBeTruthy();
  const metrics = (await harness.messages()).find(
    (message): message is Extract<ToNative, { t: "metrics" }> => message.t === "metrics" && message.paneId === paneId,
  );
  if (!metrics) throw new Error("Terminal metrics were not emitted");
  const wheelSequence = `\x1b[<64;${Math.floor(34 / metrics.cellW) + 1};${Math.floor(41 / metrics.cellH) + 1}M`;

  await harness.send(paneId, ready(paneId, "raw", "\x1b[?1000h\x1b[?1006h"));
  await harness.dispatch({ t: "scroll", paneId, deltaLines: -2, xPx: 34, yPx: 41 });
  await expect.poll(() => inputPayloads(socket)).toContain(wheelSequence.repeat(2));

  socket.received.splice(0);
  await harness.send(paneId, { type: "output", paneId, data: "\x1b[?1006l\x1b[?1000l" });
  await harness.dispatch({ t: "scroll", paneId, deltaLines: 2, xPx: 34, yPx: 41 });
  await page.waitForTimeout(50);
  expect(inputPayloads(socket)).toEqual([]);
});

test("clears native mouse tracking state when replay reset has no tracking mode", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-replay-mouse-tracking";
  await initializePane(harness, paneId, 640, 360);
  await harness.send(paneId, ready(paneId, "raw", "\x1b[?1000h\x1b[?1006h"));
  await expect
    .poll(async () =>
      (await harness.messages()).findLast((message) => message.t === "mouseTracking" && message.paneId === paneId),
    )
    .toMatchObject({ active: true });

  await harness.send(paneId, ready(paneId, "checkpoint", ""));
  await expect
    .poll(async () =>
      (await harness.messages()).findLast((message) => message.t === "mouseTracking" && message.paneId === paneId),
    )
    .toMatchObject({ active: false });
});

test("re-emits mouse tracking when a pooled pane becomes visible again", async ({ page }) => {
  const harness = await openHarness(page);
  const paneA = "pane-tracked";
  const paneB = "pane-background";
  await initializePane(harness, paneA, 640, 360);
  const socketA = await harness.socket(paneA);
  await harness.send(paneA, ready(paneA, "raw", "\x1b[?1000h\x1b[?1006h"));
  await expect
    .poll(async () =>
      (await harness.messages()).findLast((message) => message.t === "mouseTracking" && message.paneId === paneA),
    )
    .toMatchObject({ active: true });
  const priorTrackingMessages = (await harness.messages()).filter(
    (message) => message.t === "mouseTracking" && message.paneId === paneA,
  ).length;

  await harness.dispatch({ t: "attach", paneId: paneB });
  await harness.dispatch({ t: "show", paneId: paneB });
  await harness.dispatch({ t: "viewport", paneId: paneB, widthPx: 640, heightPx: 360, dpr: 1 });
  await harness.socket(paneB);
  await harness.dispatch({ t: "show", paneId: paneA });
  await expect
    .poll(
      async () =>
        (await harness.messages()).filter((message) => message.t === "mouseTracking" && message.paneId === paneA)
          .length,
    )
    .toBeGreaterThan(priorTrackingMessages);
  expect(
    (await harness.messages()).findLast((message) => message.t === "mouseTracking" && message.paneId === paneA),
  ).toMatchObject({ active: true });

  socketA.received.splice(0);
  await harness.dispatch({ t: "scroll", paneId: paneA, deltaLines: -1, xPx: 34, yPx: 41 });
  await expect.poll(() => inputPayloads(socketA).length).toBe(1);
});

test("re-emits live connection state when a pooled pane becomes visible again", async ({ page }) => {
  const harness = await openHarness(page);
  const paneA = "pane-live";
  const paneB = "pane-switch-target";
  await initializePane(harness, paneA, 640, 360);
  await harness.send(paneA, ready(paneA, "raw", "connected\r\n"));
  await expect
    .poll(
      async () =>
        (await harness.messages()).filter(
          (message) => message.t === "pane" && message.paneId === paneA && message.state === "live",
        ).length,
    )
    .toBe(1);

  await harness.dispatch({ t: "attach", paneId: paneB });
  await harness.dispatch({ t: "show", paneId: paneB });
  await harness.socket(paneB);
  await harness.dispatch({ t: "show", paneId: paneA });

  await expect
    .poll(
      async () =>
        (await harness.messages()).filter(
          (message) => message.t === "pane" && message.paneId === paneA && message.state === "live",
        ).length,
    )
    .toBe(2);
});

test("refreshes renderer state when the active pane is shown again", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-reshown";
  await initializePane(harness, paneId, 640, 360);
  await harness.send(paneId, ready(paneId, "raw", "visible terminal\r\n"));
  await expect
    .poll(
      async () =>
        (await harness.messages()).filter((message) => message.t === "metrics" && message.paneId === paneId).length,
    )
    .toBeGreaterThan(0);
  const priorMetrics = (await harness.messages()).filter(
    (message) => message.t === "metrics" && message.paneId === paneId,
  ).length;

  await harness.dispatch({ t: "show", paneId });

  await expect
    .poll(
      async () =>
        (await harness.messages()).filter((message) => message.t === "metrics" && message.paneId === paneId).length,
    )
    .toBeGreaterThan(priorMetrics);
});

test("scrolls local Ghostty scrollback without pane input when mouse tracking is disabled", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-local-scrollback";
  await initializePane(harness, paneId, 640, 360);
  const socket = await harness.socket(paneId);
  const history = Array.from({ length: 80 }, (_, index) => `line ${index}\r\n`).join("");

  await harness.send(paneId, ready(paneId, "raw", history));
  await expect
    .poll(
      async () => (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.scrollbackLength,
    )
    .toBeGreaterThan(0);
  expect(inputPayloads(socket)).toEqual([]);

  await harness.dispatch({ t: "scroll", paneId, deltaLines: -3, xPx: 34, yPx: 41 });
  await expect
    .poll(async () => (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.viewportOffset)
    .toBeGreaterThan(0);
  expect(inputPayloads(socket)).toEqual([]);

  const localViewportOffset = (await harness.snapshot()).sessions.find(
    (session) => session.paneId === paneId,
  )?.viewportOffset;
  if (!localViewportOffset) throw new Error("Local scroll did not move the viewport");
  await harness.send(paneId, { type: "output", paneId, data: "\x1b[?1000h\x1b[?1006h" });
  await expect
    .poll(async () =>
      (await harness.messages()).findLast((message) => message.t === "mouseTracking" && message.paneId === paneId),
    )
    .toMatchObject({ active: true });
  await harness.dispatch({ t: "scroll", paneId, deltaLines: -1, xPx: 34, yPx: 41 });
  await expect.poll(() => inputPayloads(socket).length).toBe(1);
  expect((await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.viewportOffset).toBe(
    localViewportOffset,
  );

  socket.received.splice(0);
  await harness.dispatch({ t: "scrollToBottom", paneId });
  await expect
    .poll(async () => (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.viewportOffset)
    .toBe(0);
  expect(inputPayloads(socket)).toEqual([]);
});

test("resolves plain and OSC 8 terminal links at native touch coordinates", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-links";
  await initializePane(harness, paneId, 640, 360);
  await harness.send(
    paneId,
    ready(
      paneId,
      "raw",
      "\x1b[2J\x1b[Hplain https://example.com/docs\r\nosc \x1b]8;;https://openai.com/docs\x07OpenAI docs\x1b]8;;\x07\r\n",
    ),
  );
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("https://example.com/docs");
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "metrics" && message.paneId === paneId),
    )
    .toBeTruthy();
  const metrics = (await harness.messages()).find(
    (message): message is Extract<ToNative, { t: "metrics" }> => message.t === "metrics" && message.paneId === paneId,
  );
  if (!metrics) throw new Error("Terminal metrics were not emitted");

  await harness.dispatch({
    t: "activateLink",
    paneId,
    requestId: "plain-link",
    xPx: 8 * metrics.cellW,
    yPx: 0.5 * metrics.cellH,
  });
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "link" && message.requestId === "plain-link"),
    )
    .toMatchObject({ t: "link", paneId, requestId: "plain-link", url: "https://example.com/docs" });

  await harness.dispatch({
    t: "activateLink",
    paneId,
    requestId: "osc-link",
    xPx: 6 * metrics.cellW,
    yPx: 1.5 * metrics.cellH,
  });
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "link" && message.requestId === "osc-link"),
    )
    .toMatchObject({ t: "link", paneId, requestId: "osc-link", url: "https://openai.com/docs" });

  await harness.dispatch({
    t: "activateLink",
    paneId,
    requestId: "no-link",
    xPx: 1.5 * metrics.cellW,
    yPx: 2.5 * metrics.cellH,
  });
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "link" && message.requestId === "no-link"),
    )
    .toEqual({ t: "link", paneId, requestId: "no-link" });
});

test("resolves a plain terminal link across a soft-wrapped row", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-wrapped-link";
  await initializePane(harness, paneId, 640, 360);
  const metrics = (await harness.messages()).find(
    (message): message is Extract<ToNative, { t: "metrics" }> => message.t === "metrics" && message.paneId === paneId,
  );
  if (!metrics) throw new Error("Terminal metrics were not emitted");

  const url = "https://login.tailscale.com/a/1164725fb32546d";
  const prefix = `${"#".repeat(Math.max(0, metrics.cols - 12))} `;
  await harness.send(paneId, ready(paneId, "raw", `\x1b[2J\x1b[H${prefix}${url}`));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("1164725fb32546d");

  await harness.dispatch({
    t: "activateLink",
    paneId,
    requestId: "wrapped-link-start",
    xPx: (metrics.cols - 5.5) * metrics.cellW,
    yPx: 0.5 * metrics.cellH,
  });
  await expect
    .poll(async () =>
      (await harness.messages()).find((message) => message.t === "link" && message.requestId === "wrapped-link-start"),
    )
    .toMatchObject({
      paneId,
      requestId: "wrapped-link-start",
      t: "link",
      url,
    });

  await harness.dispatch({
    t: "activateLink",
    paneId,
    requestId: "wrapped-link-continuation",
    xPx: 5.5 * metrics.cellW,
    yPx: 1.5 * metrics.cellH,
  });
  await expect
    .poll(async () =>
      (await harness.messages()).find(
        (message) => message.t === "link" && message.requestId === "wrapped-link-continuation",
      ),
    )
    .toMatchObject({
      paneId,
      requestId: "wrapped-link-continuation",
      t: "link",
      url,
    });
});

test("preserves a resize ownership claim while the pane socket connects", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-pending-resize-claim";
  const commands: ToHost[] = [
    { t: "init", serverUrl: "https://wmux.invalid", token: "test-token", settings },
    { t: "attach", paneId },
    { t: "show", paneId },
    { t: "viewport", paneId, widthPx: 390, heightPx: 420, dpr: 1 },
    { t: "claimResize", paneId },
  ];
  await page.evaluate((messages) => {
    const target = window as typeof window & { __wmuxHost?: { dispatch: (input: unknown) => void } };
    for (const message of messages) target.__wmuxHost?.dispatch(message);
  }, commands);

  const socket = await harness.socket(paneId);
  await expect
    .poll(() =>
      socket.received.find(
        (message): message is Extract<PaneClientMessage, { type: "input" }> =>
          message.type === "input" && message.data === "",
      ),
    )
    .toMatchObject({ type: "input", data: "", terminalResponse: true });
  const claimIndex = socket.received.findIndex((message) => message.type === "input" && message.data === "");
  expect(socket.received[claimIndex - 1]).toMatchObject({
    type: "activate",
    foreground: true,
  });
});

test("repaints a reattach replay without waiting for terminal input", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-reattach";
  const terminal = page.locator(`.terminal-session[data-pane-id="${paneId}"]`);
  await initializePane(harness, paneId, 640, 360);
  await harness.send(paneId, ready(paneId, "raw", "\x1b[2J\x1b[Hbefore reattach\r\n"));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("before reattach");
  const before = await terminal.screenshot();
  await page.evaluate((targetPaneId) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      `.terminal-session[data-pane-id="${targetPaneId}"] canvas`,
    );
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
    if (!canvas || !widthDescriptor?.get || !widthDescriptor.set) {
      throw new Error("Could not instrument the terminal canvas backing store");
    }
    let widthWrites = 0;
    Object.defineProperty(canvas, "width", {
      configurable: true,
      get: () => widthDescriptor.get?.call(canvas) as number,
      set: (value: number) => {
        widthWrites += 1;
        widthDescriptor.set?.call(canvas, value);
      },
    });
    (
      canvas as HTMLCanvasElement & {
        __wmuxBackingStoreWidthWrites?: () => number;
      }
    ).__wmuxBackingStoreWidthWrites = () => widthWrites;
  }, paneId);

  await harness.send(paneId, ready(paneId, "checkpoint", "\x1b[2J\x1b[Hpainted on reattach\r\n"));

  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("painted on reattach");
  await expect.poll(async () => Buffer.compare(await terminal.screenshot(), before)).not.toBe(0);
  await expect
    .poll(() =>
      page.evaluate((targetPaneId) => {
        const canvas = document.querySelector<
          HTMLCanvasElement & {
            __wmuxBackingStoreWidthWrites?: () => number;
          }
        >(`.terminal-session[data-pane-id="${targetPaneId}"] canvas`);
        return canvas?.__wmuxBackingStoreWidthWrites?.() ?? 0;
      }, paneId),
    )
    .toBeGreaterThan(0);
  expect(inputPayloads(await harness.socket(paneId))).toEqual([]);
});

test("preserves the painted frame until a durable reattach refresh settles", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-durable-reattach";
  const terminal = page.locator(`.terminal-session[data-pane-id="${paneId}"]`);
  await initializePane(harness, paneId, 640, 360);
  await harness.send(paneId, ready(paneId, "raw", "\x1b[2J\x1b[Hbefore durable refresh\r\n"));
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("before durable refresh");
  const before = await terminal.screenshot();

  await harness.send(paneId, {
    ...ready(paneId, "raw", ""),
    waitForRefresh: true,
  });
  await page.waitForTimeout(150);
  expect((await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n")).toContain(
    "before durable refresh",
  );
  expect(Buffer.compare(await terminal.screenshot(), before)).toBe(0);

  await harness.send(paneId, {
    type: "output",
    paneId,
    data: "\x1b[?2026h\x1b[2J\x1b[Hpainted by durable",
  });
  await page.waitForTimeout(30);
  await harness.send(paneId, {
    type: "output",
    paneId,
    data: " refresh\r\n\x1b[?2026l",
  });

  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("painted by durable refresh");
  await expect.poll(async () => Buffer.compare(await terminal.screenshot(), before)).not.toBe(0);
  expect(inputPayloads(await harness.socket(paneId))).toEqual([]);
});

test("requests a conventional redraw when a durable refresh has no visible text", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-empty-durable-refresh";
  await initializePane(harness, paneId, 640, 360);
  const socket = await harness.socket(paneId);

  await harness.send(paneId, {
    ...ready(paneId, "raw", ""),
    waitForRefresh: true,
  });
  await harness.send(paneId, {
    type: "output",
    paneId,
    data: "\x1b[2J\x1b[5;8H",
  });

  await expect
    .poll(() =>
      socket.received.find(
        (message): message is Extract<PaneClientMessage, { type: "input" }> =>
          message.type === "input" && message.data === "\x0c",
      ),
    )
    .toMatchObject({ type: "input", data: "\x0c", terminalResponse: false });

  await harness.send(paneId, {
    type: "output",
    paneId,
    data: "\r\x1b[2Kwmux@wmux:~ $ ",
  });
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("wmux@wmux:~ $");
});

test("requests a conventional redraw when an initial replay remains blank", async ({ page }) => {
  const harness = await openHarness(page);
  const paneId = "pane-empty-initial-replay";
  await initializePane(harness, paneId, 640, 360);
  const socket = await harness.socket(paneId);

  await harness.send(paneId, ready(paneId, "raw", "\x1b[2J\x1b[5;8H"));

  await expect
    .poll(() =>
      socket.received.find(
        (message): message is Extract<PaneClientMessage, { type: "input" }> =>
          message.type === "input" && message.data === "\x0c",
      ),
    )
    .toMatchObject({ type: "input", data: "\x0c", terminalResponse: false });

  await harness.send(paneId, {
    type: "output",
    paneId,
    data: "\r\x1b[2Kwmux@wmux:~ $ ",
  });
  await expect
    .poll(async () =>
      (await harness.snapshot()).sessions.find((session) => session.paneId === paneId)?.lines.join("\n"),
    )
    .toContain("wmux@wmux:~ $");
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
