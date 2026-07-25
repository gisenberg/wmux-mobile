import assert from "node:assert/strict";
import test from "node:test";

import {
  MODIFIER_DOUBLE_TAP_MS,
  initialModifierState,
  modifierIsActive,
  modifierReducer,
} from "../src/input/modifiers";

test("a single modifier tap arms it for one key", () => {
  const armed = modifierReducer(initialModifierState, { type: "tap", modifier: "ctrl", at: 100 });
  assert.equal(armed.ctrl, "armed");
  assert.equal(modifierIsActive(armed.ctrl), true);

  const consumed = modifierReducer(armed, { type: "consume" });
  assert.equal(consumed.ctrl, "off");
});

test("a quick double tap locks a modifier until explicitly toggled", () => {
  const armed = modifierReducer(initialModifierState, { type: "tap", modifier: "alt", at: 100 });
  const locked = modifierReducer(armed, {
    type: "tap",
    modifier: "alt",
    at: 100 + MODIFIER_DOUBLE_TAP_MS,
  });
  assert.equal(locked.alt, "locked");
  assert.equal(modifierReducer(locked, { type: "consume" }).alt, "locked");
  assert.equal(modifierReducer(locked, { type: "tap", modifier: "alt", at: 500 }).alt, "off");
});

test("a slow second tap toggles an armed modifier off", () => {
  const armed = modifierReducer(initialModifierState, { type: "tap", modifier: "ctrl", at: 100 });
  const off = modifierReducer(armed, {
    type: "tap",
    modifier: "ctrl",
    at: 101 + MODIFIER_DOUBLE_TAP_MS,
  });
  assert.equal(off.ctrl, "off");
});

test("consuming a key preserves locked modifiers and clears armed modifiers", () => {
  const ctrlArmed = modifierReducer(initialModifierState, { type: "tap", modifier: "ctrl", at: 100 });
  const altArmed = modifierReducer(ctrlArmed, { type: "tap", modifier: "alt", at: 150 });
  const altLocked = modifierReducer(altArmed, { type: "tap", modifier: "alt", at: 200 });
  const consumed = modifierReducer(altLocked, { type: "consume" });

  assert.equal(consumed.ctrl, "off");
  assert.equal(consumed.alt, "locked");
});
