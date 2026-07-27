#!/usr/bin/env bash

set -euo pipefail

rtk npm ci
rtk npm run build:host
rtk npx expo prebuild --platform android --clean --no-install
rtk node scripts/ci/configure-android-build.mjs android/app/build.gradle
rtk ./android/gradlew --project-dir android --no-daemon --stacktrace :app:assembleRelease
rtk "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify \
  --verbose \
  android/app/build/outputs/apk/release/app-release.apk
rtk node \
  scripts/ci/verify-android-apk.mjs \
  android/app/build/outputs/apk/release/output-metadata.json
