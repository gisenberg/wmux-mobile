import assert from "node:assert/strict";
import test from "node:test";

import { TerminalViewportCoordinator, type TerminalViewport } from "../src/terminal/viewport-coordinator";

const createFrameScheduler = () => {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    cancel: (handle: number) => callbacks.delete(handle),
    flush: () => {
      const queued = [...callbacks.values()];
      callbacks.clear();
      for (const callback of queued) callback(0);
    },
    schedule: (callback: FrameRequestCallback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
  };
};

test("holds keyboard animation layouts and commits only the final viewport", () => {
  const frames = createFrameScheduler();
  const committed: TerminalViewport[] = [];
  const coordinator = new TerminalViewportCoordinator(
    (viewport) => committed.push(viewport),
    frames.schedule,
    frames.cancel,
  );

  coordinator.update({ width: 390, height: 600 });
  coordinator.beginTransition();
  coordinator.update({ width: 390, height: 560 });
  coordinator.update({ width: 390, height: 480 });
  coordinator.endTransition();
  coordinator.update({ width: 390, height: 360 });

  assert.deepEqual(committed, [{ width: 390, height: 600 }]);
  frames.flush();
  assert.equal(committed.length, 1);
  frames.flush();
  assert.deepEqual(committed, [
    { width: 390, height: 600 },
    { width: 390, height: 360 },
  ]);
});

test("a restarted keyboard transition cancels an obsolete settling commit", () => {
  const frames = createFrameScheduler();
  const committed: TerminalViewport[] = [];
  const coordinator = new TerminalViewportCoordinator(
    (viewport) => committed.push(viewport),
    frames.schedule,
    frames.cancel,
  );

  coordinator.beginTransition();
  coordinator.update({ width: 390, height: 360 });
  coordinator.endTransition();
  frames.flush();
  coordinator.beginTransition();
  coordinator.update({ width: 390, height: 350 });
  frames.flush();

  assert.deepEqual(committed, []);
  coordinator.endTransition();
  frames.flush();
  frames.flush();
  assert.deepEqual(committed, [{ width: 390, height: 350 }]);
});

test("deduplicates unchanged viewport layouts", () => {
  const committed: TerminalViewport[] = [];
  const coordinator = new TerminalViewportCoordinator((viewport) => committed.push(viewport));

  coordinator.update({ width: 390, height: 360 });
  coordinator.update({ width: 390, height: 360 });

  assert.deepEqual(committed, [{ width: 390, height: 360 }]);
});

test("coalesces ordinary layout jitter after the initial viewport", () => {
  const frames = createFrameScheduler();
  const committed: TerminalViewport[] = [];
  const coordinator = new TerminalViewportCoordinator(
    (viewport) => committed.push(viewport),
    frames.schedule,
    frames.cancel,
  );

  coordinator.update({ width: 390, height: 600 });
  coordinator.update({ width: 390, height: 599 });
  coordinator.update({ width: 390, height: 598 });

  assert.deepEqual(committed, [{ width: 390, height: 600 }]);
  frames.flush();
  frames.flush();
  assert.deepEqual(committed, [
    { width: 390, height: 600 },
    { width: 390, height: 598 },
  ]);
});

test("cancels pending frames on disposal and can reactivate after a strict-effect cleanup", () => {
  const frames = createFrameScheduler();
  const committed: TerminalViewport[] = [];
  const coordinator = new TerminalViewportCoordinator(
    (viewport) => committed.push(viewport),
    frames.schedule,
    frames.cancel,
  );

  coordinator.beginTransition();
  coordinator.update({ width: 390, height: 360 });
  coordinator.endTransition();
  coordinator.dispose();
  frames.flush();
  frames.flush();
  assert.deepEqual(committed, []);

  coordinator.activate();
  coordinator.update({ width: 390, height: 350 });
  assert.deepEqual(committed, [{ width: 390, height: 350 }]);
});
