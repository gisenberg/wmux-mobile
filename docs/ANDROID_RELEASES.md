# Android release delivery

The Android GitHub Actions workflow produces a standalone universal APK on the repository-scoped `homelab` runner.
The pinned Docker image supplies Android SDK 36, Build Tools 36.0.0, NDK 27.1, CMake 3.22.1, Node.js 22.13.1, and JDK 17.

## Rolling builds

Every relevant push to `main` and every manual dispatch creates a prerelease tagged `android-ci-<run-number>`.
The release contains `wmux-android-<app-version>-<version-code>.apk`.
The workflow retains the newest three tags in the `android-ci-` namespace and deletes older releases and their generated tags.
No release or tag outside that namespace is pruned.

The GitHub Actions run number becomes Android's monotonically increasing `versionCode`.
The version in `app.json` remains the user-visible `versionName`.
This permits an installed rolling build to be upgraded in place.

## Deliberate releases

Pushing a `v*` tag builds the same verified APK and attaches it to the matching non-prerelease GitHub release.
These releases are permanent because the retention job only manages the reserved `android-ci-` namespace.
If the release already exists, its notes and other assets are preserved and only the APK with the same filename is replaced.

## Signing

The standalone APK is signed with a repository-specific PKCS#12 key.
The workflow requires these GitHub Actions secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore is decoded into the runner's temporary directory, mounted read-only into the Android build container, and removed in an always-run cleanup step.
Gradle receives passwords only through the build process environment.
The workflow verifies the APK signature, application ID, release variant, universal output, version name, version code, and minimum file size before publishing.

Keep an encrypted backup of the PKCS#12 file outside GitHub.
Losing the key prevents future APKs from upgrading existing installations.

## Installation

Download the APK from the newest Android prerelease on the repository Releases page.
Android may require enabling installation from the browser or file-manager app used to open the APK.
Subsequent builds can install over the existing app because they use the same package name, signing key, and a larger version code.
