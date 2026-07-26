import assert from "node:assert/strict";
import test from "node:test";

import {
  compareBuildNumbers,
  incrementBuildNumber,
  selectBuildNumber,
} from "../scripts/ci/testflight-build-number.mjs";

test("increments App Store build numbers", () => {
  assert.equal(incrementBuildNumber(undefined), "1");
  assert.equal(incrementBuildNumber("1"), "2");
  assert.equal(incrementBuildNumber("1.9"), "1.10");
});

test("compares numeric build number components", () => {
  assert.equal(compareBuildNumbers("2", "1.99"), 1);
  assert.equal(compareBuildNumbers("1.2", "1.2.0"), 0);
  assert.equal(compareBuildNumbers("1.2.1", "1.2"), 1);
});

test("uses a unique GitHub run number while App Store processing lags", () => {
  assert.equal(selectBuildNumber("1", "8"), "8");
  assert.equal(selectBuildNumber(undefined, "8"), "8");
  assert.equal(selectBuildNumber("9", "8"), "10");
  assert.equal(selectBuildNumber("1", undefined), "2");
});

test("rejects invalid App Store build numbers", () => {
  assert.throws(() => incrementBuildNumber("1.2.3.4"), /Invalid App Store build number/);
  assert.throws(() => selectBuildNumber("1", "run-8"), /Invalid App Store build number/);
});
