# wmux mobile

A phone-first native iOS and Android client for [wmux](../wmux).

The project implements the foundation through the M6 native selection and clipboard work described in [PLAN.md](PLAN.md).
It provides an Expo SDK 57 development-build foundation, strict TypeScript, reproducible protocol and terminal dependency vendoring, secure connection storage, authenticated bootstrap loading, a reconnecting event stream, a single-WebView Ghostty terminal pool, platform-native terminal key input, phone-first workspace navigation, touch selection, and native clipboard handoff.

## Requirements

- Node.js 22.13 or newer
- Xcode 26.4 or newer for iOS
- Android SDK 36, an Android emulator, and JDK 17 or newer for Android
- The adjacent `../wmux` checkout when refreshing vendored sources

## Setup

```sh
npm install
npm run check
```

Create and install development builds:

```sh
npm run ios
npm run android
```

Start Metro for an already-installed development build:

```sh
npm run start
```

Expo Go is intentionally unsupported.
The native input module requires a development build.
The native run and Metro scripts build the self-contained offline terminal host before starting Expo.

## CI and Android builds

The main CI workflow runs in a pinned Playwright Ubuntu container on the repository-scoped `homelab-wmux-mobile` self-hosted runner.
The Android workflow uses the same runner and builds inside the pinned toolchain defined by `docker/android/Dockerfile`, so the host does not need an Android SDK installation.
It produces a signed standalone APK that runs without Metro and publishes it as a GitHub prerelease.
The newest three automated releases are retained, while deliberate `v*` releases remain permanent.
The Docker build cache plus persistent npm and Gradle caches remain on `homelab` between jobs.
See [docs/ANDROID_RELEASES.md](docs/ANDROID_RELEASES.md) for signing, versioning, retention, and installation details.

## TestFlight

The manually dispatched GitHub Actions workflow builds, signs, validates, and uploads a release from the repository-specific registration on the shared self-hosted Mac.
See [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md) for the runner, secret, versioning, and delivery contract.

## Terminal host

The host page is built from `src/terminal/host` into one self-contained HTML asset.
It owns pane WebSockets and terminal output, while the React Native bridge carries only semantic input and low-frequency state.
The pool retains at most three Ghostty terminals and shows one at a time.

Build and test it independently:

```sh
npm run build:host
npm run test:host
```

The Playwright suite uses mocked pane WebSockets to cover raw and checkpoint replay, resize, semantic key encoding, bracketed paste, OSC 52, alternate-screen state, Kitty media, selection, and pool eviction.
It also verifies a deterministic screenshot rendered with the Ghostty package and color schemes pinned from the adjacent wmux commit.

The terminal host bundles Fira Code and the same MesloLGM Nerd Font Mono faces as wmux, including regular, bold, italic, and bold italic.
The app header exposes a renderer diagnostic that initializes those fonts, JavaScript, and Ghostty WebAssembly inside the platform WebView without contacting a server.

## Native terminal input

The local `modules/wmux-key-input` Expo module owns software-keyboard and hardware-key input while the terminal WebView remains unfocused.
It disables autocorrection, spell checking, smart punctuation, capitalization, suggestions, and Android fullscreen extract mode.
The iOS implementation supplies a native keyboard accessory row.
The Android implementation pairs its native input connection with a React Native row synchronized to the IME.
Both rows expose Escape, Tab, arrows, Ctrl, Alt, and terminal punctuation.
Ctrl and Alt arm for one key on a single tap and lock on a double tap.
Held arrows repeat in native code without JavaScript timers.
The renderer diagnostic includes an offline key-input mode that records committed text, semantic keys, modifier state, and keyboard focus.

## Workspace navigation

The connected dashboard resolves workspace, tab, and pane selection locally while repairing stale selections against every new bootstrap snapshot.
The native chrome includes an edge-swipe workspace drawer, horizontal tab bar, split-pane selector, active-host context, and a bottom-sheet action menu.
Workspace, tab, split, close, and settings mutations use the authenticated wmux REST API and commit the returned state immediately.
Destructive actions require confirmation.
Horizontal terminal swipes cycle tabs while alternate-screen applications keep exclusive gesture control.
Settings cover all seven vendored terminal color schemes, font size, TUI frame rate, and scroll delivery.
The selected terminal theme colors the workspace chrome and app header.
An offline navigation diagnostic exercises the same drawer, tabs, pane bar, host picker, actions, settings, themes, and gestures without contacting a server.
The modals support portrait and both landscape orientations and account for platform safe areas.

## Native touch and clipboard

The terminal interaction layer turns vertical drags into line-based scrollback with momentum, snaps an upward fling back to live output, and keeps horizontal tab cycling disabled while an alternate-screen application is active.
Long press begins selection with a native loupe and draggable handles.
Double tap selects a word, triple tap selects a line, and the native toolbar exposes copy, select all, and clear.

The Paste action reads the system clipboard only after an explicit tap and delegates bracketed-paste encoding to the terminal host.
iOS can still show its unavoidable paste confirmation.
Terminal OSC 52 output and `/ws/events` clipboard handoffs write directly to the native clipboard and surface a confirmation toast.
The Media action can stage a clipboard image through the pane image-paste API or upload selected photos as pane attachments before pasting the resulting paths.
Camera and microphone permissions are intentionally disabled.

The renderer diagnostic includes offline touch and clipboard fixtures for scroll, selection geometry, copy, and paste behavior without contacting a server.
Pure interaction helpers and the binary image-upload contract are covered by unit tests.

## Connect to wmux

Enter the HTTPS origin of a wmux server from the first-run screen.
The app supports the server's username and password login flow or a pre-issued access token.
Passwords are used only for the login request and are never persisted.
The resulting access token and server origin are stored with the platform secure-storage service.

For local development, a non-secret default server origin can be supplied to Metro:

```sh
cp .env.example .env.local
npm run start
```

Only variables prefixed with `EXPO_PUBLIC_` are available to the client bundle.
Never put credentials or access tokens in an Expo environment variable.

The app verifies the server protocol version when the endpoint is available.
Current servers without `/api/protocol` are accepted as legacy-compatible and identified in the connection status.
An advertised version mismatch is treated as a blocking compatibility error.

## Vendored contracts

The server contract is generated from `../wmux/src/shared/protocol.ts` and its shared type-only imports:

```sh
npm run sync:protocol
```

The Ghostty Web package is mirrored from the adjacent wmux vendor directory:

```sh
npm run sync:ghostty
```

The host-side OSC 52, Kitty graphics, and color-scheme implementations are generated from the same pinned wmux commit:

```sh
npm run sync:terminal-sources
```

Generated protocol and terminal vendor files must not be edited by hand.
`npm run check` verifies every pinned source and the transformed strict-TypeScript output.
