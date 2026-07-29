import assert from "node:assert/strict";
import test from "node:test";

import type { BootstrapPayload, EventStateDelta, TerminalNotification, WmuxSettings } from "../protocol/wmux";
import {
  ProtocolMismatchError,
  WmuxApiClient,
  normalizeBaseUrl,
  webSocketUrl,
  type FetchLike,
} from "../src/api/client";
import { reconnectDelay } from "../src/events/event-stream";
import {
  applyEventMessage,
  bootstrapSatisfiesEventDelta,
  bootstrapSatisfiesHealthDelta,
  eventDeltaRequiresResync,
  healthDeltaRequiresResync,
} from "../src/state/bootstrap";

const settings: WmuxSettings = {
  collapsedWorkspaceIds: [],
  colorScheme: "wmux",
  favoriteWorkspaceIds: [],
  inactiveTabStreaming: "suspend",
  machineAliases: {},
  terminalFontSize: 14,
  terminalScrollMode: "batched",
  terminalScrollbackRows: 5_000,
  tuiFrameRate: 30,
};

const bootstrap = (revision = 1): BootstrapPayload => ({
  activeWorkspaceId: "",
  agentEvents: [],
  agentTimelines: [],
  delegation: {
    notificationBudgetSeconds: { running: 7_200, waiting: 300 },
    preferHeadless: false,
    waitTimeoutBoundsSeconds: { max: 14_400, min: 0.1 },
    waitTimeoutSeconds: { change: 7_200, deploy: 7_200, review: 1_800 },
  },
  delegations: [],
  eventRevision: 1,
  healthEpoch: 1,
  keybindings: {} as BootstrapPayload["keybindings"],
  machines: [],
  notifications: [],
  revision,
  runs: [],
  settings,
  settingsDefaults: settings,
  streams: [],
  terminalFontFamily: '"Fira Code", monospace',
  workspaceTreeRevision: 1,
  workspaces: [],
});

const notification = (id: string, title = "Done"): TerminalNotification => ({
  body: "The task completed.",
  createdAt: "2026-07-25T12:00:00.000Z",
  id,
  paneId: "pane-1",
  read: false,
  subtitle: "wmux",
  tabId: "tab-1",
  title,
  workspaceId: "workspace-1",
});

test("normalizes a wmux server origin without weakening URL validation", () => {
  assert.equal(normalizeBaseUrl(" wmux.example.ts.net:3478 "), "https://wmux.example.ts.net:3478");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:3478/"), "http://127.0.0.1:3478");

  for (const value of [
    "",
    "ssh://wmux.example",
    "https://user:secret@wmux.example",
    "https://wmux.example/api",
    "https://wmux.example?token=secret",
    "https://wmux.example#fragment",
  ]) {
    assert.throws(() => normalizeBaseUrl(value));
  }
});

test("constructs an authenticated websocket URL", () => {
  assert.equal(
    webSocketUrl("https://wmux.example.ts.net:3478", "/ws/events", "space + slash/"),
    "wss://wmux.example.ts.net:3478/ws/events?token=space+%2B+slash%2F",
  );
  assert.equal(webSocketUrl("http://127.0.0.1:3478", "/ws/events", undefined), "ws://127.0.0.1:3478/ws/events");
});

test("API requests limit credentials to authenticated endpoints", async () => {
  const requests: { headers: Headers; url: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({ headers: new Headers(init?.headers), url: input });
    return Response.json({ ok: true });
  };
  const client = new WmuxApiClient("https://wmux.example", "access-token", fetchImpl);

  await client.health();
  await client.bootstrap();

  assert.equal(requests[0]?.url, "https://wmux.example/api/health");
  assert.equal(requests[0]?.headers.has("authorization"), false);
  assert.equal(requests[1]?.url, "https://wmux.example/api/bootstrap");
  assert.equal(requests[1]?.headers.get("authorization"), "Bearer access-token");
});

test("workspace mutations use the wmux REST contract and preserve authentication", async () => {
  const requests: { body: string | undefined; headers: Headers; method: string; url: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: input,
    });
    return Response.json({ settings: bootstrap().settings, state: bootstrap(), tab: {}, workspace: {} });
  };
  const client = new WmuxApiClient("https://wmux.example", "access-token", fetchImpl);
  const settings = bootstrap().settings;

  await client.updateSettings(settings);
  await client.createWorkspace("machine/one", "pane source");
  await client.createTab("workspace/one", "machine/one", "pane source");
  await client.splitPane("tab/one", "pane/one", "vertical", "machine/one");
  await client.closePane("tab/one", "pane/one");
  await client.closeTab("workspace/one", "tab/one");
  await client.closeWorkspace("workspace/one");

  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "POST", url: "https://wmux.example/api/settings" },
      { method: "POST", url: "https://wmux.example/api/workspaces" },
      { method: "POST", url: "https://wmux.example/api/workspaces/workspace%2Fone/tabs" },
      { method: "POST", url: "https://wmux.example/api/tabs/tab%2Fone/split" },
      { method: "DELETE", url: "https://wmux.example/api/tabs/tab%2Fone/panes/pane%2Fone" },
      { method: "DELETE", url: "https://wmux.example/api/workspaces/workspace%2Fone/tabs/tab%2Fone" },
      { method: "DELETE", url: "https://wmux.example/api/workspaces/workspace%2Fone" },
    ],
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), {
    machineId: "machine/one",
    sourcePaneId: "pane source",
  });
  assert.deepEqual(JSON.parse(requests[3]?.body ?? ""), {
    direction: "vertical",
    machineId: "machine/one",
    paneId: "pane/one",
  });
  assert.ok(requests.every(({ headers }) => headers.get("authorization") === "Bearer access-token"));
});

test("native image paste and attachment requests preserve binary and JSON contracts", async () => {
  const requests: { body: BodyInit | null | undefined; headers: Headers; method: string; url: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({
      body: init?.body,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: input,
    });
    if (input.endsWith("/paste-images") && init?.method === "POST") {
      return Response.json({
        bytes: 4,
        expiresAt: "2026-07-25T13:00:00.000Z",
        mimeType: "image/png",
        stageId: "stage-1",
        targetPath: "/tmp/wmux/stage-1.png",
      });
    }
    if (input.endsWith("/attachments")) {
      return Response.json({
        attachment: {
          bytes: 4,
          createdAt: "2026-07-25T12:00:00.000Z",
          id: "attachment-1",
          mimeType: "image/png",
          name: "pixel.png",
          paneId: "pane/one",
          url: "/api/attachments/pane/one/pixel.png",
        },
      });
    }
    return Response.json({ removed: true });
  };
  const client = new WmuxApiClient("https://wmux.example", "access-token", fetchImpl);
  const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

  const staged = await client.stagePanePasteImage("pane/one", image);
  await client.discardPanePasteImage("pane/one", staged.stageId);
  await client.uploadPaneAttachment("pane/one", {
    data: "iVBORw==",
    mimeType: "image/png",
    name: "pixel.png",
  });

  assert.deepEqual(
    requests.map(({ headers, method, url }) => ({
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      method,
      url,
    })),
    [
      {
        authorization: "Bearer access-token",
        contentType: "application/octet-stream",
        method: "POST",
        url: "https://wmux.example/api/panes/pane%2Fone/paste-images",
      },
      {
        authorization: "Bearer access-token",
        contentType: null,
        method: "DELETE",
        url: "https://wmux.example/api/panes/pane%2Fone/paste-images/stage-1",
      },
      {
        authorization: "Bearer access-token",
        contentType: "application/json",
        method: "POST",
        url: "https://wmux.example/api/panes/pane%2Fone/attachments",
      },
    ],
  );
  assert.equal(requests[0]?.body, image);
  assert.deepEqual(JSON.parse(String(requests[2]?.body)), {
    data: "iVBORw==",
    mimeType: "image/png",
    name: "pixel.png",
  });
});

test("protocol negotiation accepts legacy servers and rejects actual mismatches", async () => {
  const legacy = new WmuxApiClient(
    "https://wmux.example",
    "token",
    async () => new Response("Not found", { status: 404 }),
  );
  assert.deepEqual(await legacy.protocolStatus(), { kind: "legacy", version: null });

  const current = new WmuxApiClient("https://wmux.example", "token", async () => Response.json({ protocolVersion: 1 }));
  assert.deepEqual(await current.protocolStatus(), { kind: "verified", version: 1 });

  const mismatched = new WmuxApiClient("https://wmux.example", "token", async () =>
    Response.json({ protocolVersion: 2 }),
  );
  await assert.rejects(mismatched.protocolStatus(), ProtocolMismatchError);
});

test("reconnect backoff is bounded and deterministic with injected jitter", () => {
  assert.equal(reconnectDelay(0, 0.5), 750);
  assert.equal(reconnectDelay(1, 0.5), 1_500);
  assert.equal(reconnectDelay(4, 0.5), 8_000);
  assert.equal(reconnectDelay(99, 1), 9_600);
  assert.equal(reconnectDelay(-5, 0), 600);
});

test("event reducers apply compatible health, replace current snapshots, and de-duplicate notifications", () => {
  const initial = {
    ...bootstrap(2),
    notifications: [notification("n-1", "Old")],
  };
  const futureHealth = {
    healthEpoch: 4,
    revision: 3,
    streams: [],
    type: "health",
  } as const;
  assert.equal(healthDeltaRequiresResync(initial, futureHealth), true);
  assert.equal(applyEventMessage(initial, futureHealth), initial);

  const health = applyEventMessage(initial, {
    healthEpoch: 4,
    revision: 2,
    streams: [],
    type: "health",
  });
  assert.equal(health.healthEpoch, 4);
  assert.equal(health.revision, 2);
  assert.equal(health.machines, initial.machines);

  const notified = applyEventMessage(health, {
    notification: notification("n-1", "Updated"),
    type: "notification",
  });
  assert.equal(notified.notifications.length, 1);
  assert.equal(notified.notifications[0]?.title, "Updated");

  const replacement = bootstrap(8);
  assert.equal(
    applyEventMessage(notified, {
      reason: "resync",
      revision: 8,
      state: replacement,
      type: "snapshot",
    }),
    replacement,
  );
});

test("event reducers apply sequential collection deltas without replacing unrelated state", () => {
  const initial = {
    ...bootstrap(2),
    eventRevision: 4,
    notifications: [notification("n-1", "Old")],
  };
  const message = {
    baseEventRevision: 4,
    eventRevision: 5,
    healthEpoch: 1,
    notifications: {
      order: ["n-2"],
      removedIds: ["n-1"],
      upserted: [notification("n-2", "New")],
    },
    revision: 3,
    type: "delta",
  } satisfies EventStateDelta;

  const updated = applyEventMessage(initial, message);

  assert.equal(updated.eventRevision, 5);
  assert.equal(updated.revision, 3);
  assert.deepEqual(updated.notifications, [notification("n-2", "New")]);
  assert.equal(updated.workspaces, initial.workspaces);
  assert.equal(updated.settings, initial.settings);
});

test("event revision gaps and newer health epochs require a bootstrap resync", () => {
  const initial = { ...bootstrap(), eventRevision: 7, healthEpoch: 3 };
  const gap = {
    baseEventRevision: 8,
    eventRevision: 9,
    healthEpoch: 3,
    revision: 2,
    type: "delta",
  } satisfies EventStateDelta;

  assert.equal(eventDeltaRequiresResync(initial, gap), true);
  assert.equal(
    eventDeltaRequiresResync(initial, {
      ...gap,
      baseEventRevision: 7,
      eventRevision: 8,
    }),
    false,
  );
  assert.equal(
    eventDeltaRequiresResync(initial, {
      ...gap,
      baseEventRevision: 5,
      eventRevision: 6,
    }),
    false,
  );
  assert.equal(
    eventDeltaRequiresResync(initial, {
      ...gap,
      baseEventRevision: 7,
      eventRevision: 8,
      healthEpoch: 4,
    }),
    true,
  );
  assert.equal(bootstrapSatisfiesEventDelta(gap, { eventRevision: 8, healthEpoch: 3 }), false);
  assert.equal(bootstrapSatisfiesEventDelta(gap, { eventRevision: 9, healthEpoch: 3 }), true);
  assert.equal(bootstrapSatisfiesEventDelta(gap, { eventRevision: 0, healthEpoch: 4 }), true);
  assert.equal(bootstrapSatisfiesHealthDelta({ healthEpoch: 4, revision: 8 }, { healthEpoch: 3, revision: 8 }), false);
  assert.equal(bootstrapSatisfiesHealthDelta({ healthEpoch: 4, revision: 8 }, { healthEpoch: 1, revision: 9 }), true);
});

test("older state deltas advance event ordering without regressing newer HTTP state", () => {
  const initial = { ...bootstrap(9), eventRevision: 4 };
  const updated = applyEventMessage(initial, {
    baseEventRevision: 4,
    eventRevision: 5,
    healthEpoch: 1,
    notifications: {
      removedIds: [],
      upserted: [notification("n-1")],
    },
    revision: 8,
    type: "delta",
  });

  assert.equal(updated.eventRevision, 5);
  assert.equal(updated.revision, 9);
  assert.equal(updated.notifications, initial.notifications);
});

test("older snapshots cannot regress newer state", () => {
  const initial = { ...bootstrap(9), eventRevision: 7, healthEpoch: 3 };
  const stale = { ...bootstrap(8), eventRevision: 9, healthEpoch: 4 };

  assert.equal(
    applyEventMessage(initial, {
      reason: "resync",
      revision: stale.revision,
      state: stale,
      type: "snapshot",
    }),
    initial,
  );
});
