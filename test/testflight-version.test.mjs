import assert from "node:assert/strict";
import test from "node:test";

import { expectedBundleIdentifier, verifyTestFlightVersion } from "../scripts/ci/verify-testflight-version.mjs";

const applicationInfo = {
  CFBundleIdentifier: expectedBundleIdentifier,
  CFBundleShortVersionString: "0.1.0",
  CFBundleVersion: "15",
};

test("accepts an archive with the expected release metadata", () => {
  assert.deepEqual(
    verifyTestFlightVersion(applicationInfo, {
      buildNumber: "15",
      marketingVersion: "0.1.0",
    }),
    {
      buildNumber: "15",
      bundleIdentifier: expectedBundleIdentifier,
      marketingVersion: "0.1.0",
    },
  );
});

test("rejects an archive whose build number did not reach Info.plist", () => {
  assert.throws(
    () =>
      verifyTestFlightVersion(applicationInfo, {
        buildNumber: "16",
        marketingVersion: "0.1.0",
      }),
    /Archived build number is 15, expected 16/,
  );
});

test("rejects an archive for a different App Store application", () => {
  assert.throws(
    () =>
      verifyTestFlightVersion(
        {
          ...applicationInfo,
          CFBundleIdentifier: "com.example.other",
        },
        {
          buildNumber: "15",
          marketingVersion: "0.1.0",
        },
      ),
    /Archived bundle identifier is com\.example\.other/,
  );
});
