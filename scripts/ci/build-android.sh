#!/usr/bin/env bash

set -euo pipefail

npm ci
npm run build:host
npx expo prebuild --platform android --clean --no-install
./android/gradlew --project-dir android --no-daemon --stacktrace :app:assembleDebug
