import assert from "node:assert/strict";
import test from "node:test";

import { configureAndroidBuild, normalizeAndroidVersionCode } from "../scripts/ci/configure-android-build.mjs";
import {
  automatedAndroidTagPrefix,
  createAndroidReleasePlan,
  selectAutomatedAndroidReleasesForDeletion,
} from "../scripts/ci/publish-android-release.mjs";
import { expectedAndroidApplicationId, verifyAndroidApkMetadata } from "../scripts/ci/verify-android-apk.mjs";

const generatedBuildGradle = `
android {
    defaultConfig {
        versionCode 1
        versionName "0.1.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

test("configures a standalone Android release with a unique version and CI signing", () => {
  const configured = configureAndroidBuild(generatedBuildGradle, {
    versionCode: "27",
    versionName: "0.1.0",
  });
  assert.match(configured, /versionCode 27/);
  assert.match(configured, /versionName "0\.1\.0"/);
  assert.match(configured, /ANDROID_KEYSTORE_PATH/);
  assert.match(configured, /signingConfig signingConfigs\.release/);
  assert.match(configured, /debug \{\s*signingConfig signingConfigs\.debug/);
  assert.doesNotMatch(configured, /release \{\s*signingConfig signingConfigs\.debug/);
});

test("rejects Android version codes outside the platform range", () => {
  assert.equal(normalizeAndroidVersionCode("15"), 15);
  assert.throws(() => normalizeAndroidVersionCode("0"), /between 1 and/);
  assert.throws(() => normalizeAndroidVersionCode("release-15"), /Invalid Android version code/);
});

test("verifies the universal release APK metadata", () => {
  assert.deepEqual(
    verifyAndroidApkMetadata(
      {
        applicationId: expectedAndroidApplicationId,
        artifactType: { type: "APK" },
        elements: [
          {
            filters: [],
            outputFile: "app-release.apk",
            type: "SINGLE",
            versionCode: 15,
            versionName: "0.1.0",
          },
        ],
        variantName: "release",
      },
      {
        versionCode: 15,
        versionName: "0.1.0",
      },
    ),
    {
      applicationId: expectedAndroidApplicationId,
      outputFile: "app-release.apk",
      versionCode: 15,
      versionName: "0.1.0",
    },
  );
});

test("uses rolling prereleases for main and permanent releases for deliberate tags", () => {
  const rolling = createAndroidReleasePlan({
    refName: "main",
    refType: "branch",
    runNumber: "15",
    sha: "abc123",
    versionCode: 15,
    versionName: "0.1.0",
  });
  assert.equal(rolling.tagName, `${automatedAndroidTagPrefix}15`);
  assert.equal(rolling.prerelease, true);
  assert.equal(rolling.deliberateTag, false);

  const tagged = createAndroidReleasePlan({
    refName: "v0.1.0",
    refType: "tag",
    runNumber: "16",
    sha: "def456",
    versionCode: 16,
    versionName: "0.1.0",
  });
  assert.equal(tagged.tagName, "v0.1.0");
  assert.equal(tagged.prerelease, false);
  assert.equal(tagged.deliberateTag, true);
});

test("prunes only rolling Android releases beyond the newest three", () => {
  const releases = [
    { created_at: "2026-07-27T04:00:00Z", id: 4, tag_name: "android-ci-4" },
    { created_at: "2026-07-27T03:00:00Z", id: 3, tag_name: "android-ci-3" },
    { created_at: "2026-07-27T02:00:00Z", id: 2, tag_name: "android-ci-2" },
    { created_at: "2026-07-27T01:00:00Z", id: 1, tag_name: "android-ci-1" },
    { created_at: "2026-07-20T01:00:00Z", id: 99, tag_name: "v0.1.0" },
  ];
  assert.deepEqual(
    selectAutomatedAndroidReleasesForDeletion(releases).map((release) => release.tag_name),
    ["android-ci-1"],
  );
});
