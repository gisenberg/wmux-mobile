import assert from "node:assert/strict";
import test from "node:test";

import { buildChatThread, detectedAgentName } from "../src/chat/model";
import { navigationFixture } from "../src/navigation/fixture";
import { resolveNavigation } from "../src/navigation/model";

test("chat thread contains only activity for the active workspace and pane", () => {
  const bootstrap = {
    ...navigationFixture,
    agentEvents: [
      {
        agent: "codex",
        createdAt: "2026-07-25T12:02:00.000Z",
        id: "agent-active",
        message: "Implemented the terminal shell.",
        paneId: "pane-agent",
        status: "completed",
        summary: "Done",
        tabId: "tab-agent",
        title: "Terminal shell",
        workspaceId: "workspace-remote",
      },
      {
        agent: "claude",
        createdAt: "2026-07-25T12:03:00.000Z",
        id: "agent-other",
        paneId: "pane-shell",
        status: "running",
        summary: "Working",
        tabId: "tab-shell",
        title: "Other pane",
        workspaceId: "workspace-project",
      },
    ],
    notifications: [
      {
        body: "Ready",
        createdAt: "2026-07-25T12:04:00.000Z",
        id: "notification-active",
        paneId: "pane-agent",
        read: false,
        subtitle: "",
        tabId: "tab-agent",
        title: "Codex",
        workspaceId: "workspace-remote",
      },
    ],
  };

  const thread = buildChatThread(bootstrap, "workspace-remote", "pane-agent");
  assert.deepEqual(
    thread.map((item) => item.id),
    ["agent:agent-active", "notification:notification-active"],
  );
});

test("agent detection trusts explicit pane titles and recent pane activity", () => {
  const navigation = resolveNavigation(navigationFixture, {
    paneId: "pane-agent",
    tabId: "tab-agent",
    workspaceId: "workspace-remote",
  });
  assert.equal(detectedAgentName(navigation!.pane, []), "Codex");

  const shell = resolveNavigation(navigationFixture)!.pane;
  assert.equal(
    detectedAgentName(
      shell,
      [
        {
          agent: "claude",
          createdAt: "2026-07-25T12:00:00.000Z",
          id: "recent",
          paneId: shell.id,
          status: "waiting",
          summary: "Waiting",
          tabId: "tab-shell",
          title: "Claude",
          workspaceId: "workspace-project",
        },
      ],
      Date.parse("2026-07-25T13:00:00.000Z"),
    ),
    "claude",
  );
  assert.equal(
    detectedAgentName(
      shell,
      [
        {
          agent: "claude",
          createdAt: "2026-07-24T00:00:00.000Z",
          id: "stale",
          paneId: shell.id,
          status: "completed",
          summary: "Done",
          tabId: "tab-shell",
          title: "Claude",
          workspaceId: "workspace-project",
        },
      ],
      Date.parse("2026-07-25T13:00:00.000Z"),
    ),
    undefined,
  );
});
