#!/usr/bin/env bash

set -euo pipefail

npm ci
npm run build:host
npx expo prebuild --platform android --clean --no-install
node scripts/ci/configure-android-build.mjs android/app/build.gradle
./android/gradlew --project-dir android --no-daemon --stacktrace :app:assembleRelease
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify \
  --verbose \
  android/app/build/outputs/apk/release/app-release.apk
node \
  scripts/ci/verify-android-apk.mjs \
  android/app/build/outputs/apk/release/output-metadata.json
