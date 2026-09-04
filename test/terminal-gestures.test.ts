import assert from "node:assert/strict";
import test from "node:test";
import type { GestureResponderEvent, PanResponderGestureState } from "react-native";
import { TerminalGestureController } from "../src/terminal/gesture-controller";
import type { ToHost } from "../src/terminal/bridge";

const event = (x = 100, y = 100, timestamp = 1000) =>
  ({
    nativeEvent: { pageX: x, pageY: y, locationX: x, locationY: y, timestamp },
  }) as GestureResponderEvent;
const gesture = (dx: number, dy: number, vy = 0) =>
  ({ dx, dy, vy, numberActiveTouches: 1 }) as PanResponderGestureState;

function harness() {
  let time = 0;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const messages: ToHost[] = [];
  const tabs: number[] = [];
  let focusCount = 0;
  const config = {
    active: true,
    altScreen: false,
    mouseTracking: false,
    paneId: "first",
    height: 400,
    width: 390,
    selection: { active: false },
    onActivateLink: async () => false,
    onCopy: () => {},
    onCycleTab: (direction: number) => tabs.push(direction),
    onFocusInput: () => {
      focusCount += 1;
    },
    onSend: (message: ToHost) => messages.push(message),
    setLoupe: () => {},
  };
  const controller = new TerminalGestureController(config, {
    now: () => time,
    request: (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancel: (handle) => {
      frames.delete(handle);
    },
  });
  const tick = (elapsed: number) => {
    time += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  };
  return { controller, config, messages, tabs, tick, frames, focusCount: () => focusCount };
}

test("a vertical drag cannot turn into a tab switch", () => {
  const h = harness();
  h.controller.grant(event());
  h.controller.move(event(102, 130), gesture(2, 30));
  h.controller.move(event(200, 140), gesture(100, 40));
  h.controller.release(event(200, 140), gesture(100, 40));
  assert.ok(h.messages.some((message) => message.t === "scroll"));
  assert.deepEqual(h.tabs, []);
  h.controller.dispose();
});

test("a horizontal swipe never sends wheel input and respects TUI modes", () => {
  for (const mode of [
    { altScreen: false, mouseTracking: false },
    { altScreen: true, mouseTracking: false },
    { altScreen: false, mouseTracking: true },
  ]) {
    const h = harness();
    h.controller.update({ ...h.config, ...mode });
    h.controller.grant(event());
    h.controller.move(event(130, 102), gesture(30, 2));
    h.controller.move(event(200, 240), gesture(100, 140));
    h.controller.release(event(200, 240), gesture(100, 140));
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.tabs, mode.altScreen || mode.mouseTracking ? [] : [-1]);
    h.controller.dispose();
  }
});

test("flings use frame-based momentum without jumping to live output", () => {
  const distances: number[] = [];
  for (const interval of [1000 / 60, 1000 / 120]) {
    const h = harness();
    h.controller.grant(event());
    h.controller.move(event(100, 0), gesture(0, -100));
    h.controller.release(event(100, 0), gesture(0, -100, -0.8));
    for (let index = 0; index < Math.round(1000 / interval); index++) h.tick(interval);
    assert.equal(
      h.messages.some((message) => message.t === "scrollToBottom"),
      false,
    );
    distances.push(h.messages.reduce((sum, message) => sum + (message.t === "scroll" ? message.deltaLines : 0), 0));
    assert.equal(h.frames.size, 0);
    h.controller.dispose();
  }
  assert.ok(Math.abs(distances[0]! - distances[1]!) <= 1);
});

test("changing panes cancels momentum and an in-progress drag", () => {
  const h = harness();
  h.controller.grant(event());
  h.controller.release(event(100, 0), gesture(0, -100, -0.8));
  assert.equal(h.frames.size, 1);
  h.controller.update({ ...h.config, paneId: "second" });
  h.tick(16);
  h.controller.move(event(100, 30), gesture(0, -70));
  h.controller.release(event(100, 30), gesture(0, -70));
  assert.deepEqual(h.messages, []);
  assert.equal(h.frames.size, 0);
  h.controller.dispose();
});

test("a swipe or pane change cancels a pending tap before it opens the keyboard", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const changePane of [false, true]) {
    const h = harness();
    h.controller.grant(event());
    h.controller.release(event(), gesture(0, 0));
    if (changePane) h.controller.update({ ...h.config, paneId: "second" });
    else {
      h.controller.grant(event());
      h.controller.move(event(100, 140), gesture(0, 40));
    }
    t.mock.timers.tick(500);
    await Promise.resolve();
    assert.equal(h.focusCount(), 0);
    assert.deepEqual(
      h.messages.filter((message) => message.t === "selection"),
      [],
    );
    h.controller.dispose();
  }
});
