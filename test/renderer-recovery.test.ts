import assert from "node:assert/strict";
import test from "node:test";

import { RendererRestartBudget } from "../src/terminal/renderer-recovery";

test("renderer restarts are allowed until the budget is spent within its window", () => {
  const budget = new RendererRestartBudget(3, 60_000);
  assert.equal(budget.tryRestart(0), true);
  assert.equal(budget.tryRestart(1_000), true);
  assert.equal(budget.tryRestart(2_000), true);
  assert.equal(budget.tryRestart(3_000), false);
  assert.equal(budget.tryRestart(60_500), true);
});

test("a reset renderer budget allows a fresh recovery attempt", () => {
  const budget = new RendererRestartBudget(1, 60_000);
  assert.equal(budget.tryRestart(0), true);
  assert.equal(budget.tryRestart(10), false);
  budget.reset();
  assert.equal(budget.tryRestart(20), true);
});
