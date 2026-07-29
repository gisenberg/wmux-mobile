# wmux-mobile Implementation Plan

A native iOS and Android client for [wmux](../wmux), phone first.

This document is the implementation brief for a capable agent.
It states the architecture, the contracts, the milestones, and the acceptance criteria.
Read it fully before writing code, and read `../wmux/AGENTS.md` for the conventions this project inherits.

## 1. Goal

wmux already works in a mobile browser, but the browser is the wrong container for a terminal on a phone.
The problems are not rendering problems, they are user-agent chrome problems:

- Safari's interactive edge-swipe steals the gesture that should open the workspace drawer.
- Clipboard reads and writes are permission-gated and require a user gesture, so OSC 52 handoff and paste are unreliable.
- The predictive/QuickType bar and autocorrect sit above the software keyboard and cannot be removed from a web page.
- `visualViewport` is a heuristic signal, so keyboard open/close and rotation produce janky, late, and occasionally wrong terminal resizes.
- There is no reliable background execution, no real push notification, and no OS-level app identity.

Every one of those disappears when the shell is native.
None of them require replacing the terminal renderer.

The goal is a native app that is materially better than the mobile web app on exactly those axes, while remaining byte-for-byte faithful to wmux's terminal behavior.

## 2. Non-goals

- Replacing or forking the wmux server as the source of truth.
  The server owns canonical workspace state and one live session client per pane.
  The mobile app is an attachable view, exactly like the browser.
- Reimplementing VT emulation.
- Tablet-optimized or desktop-class multi-pane layouts in v1.
  Phone is the target; tablets should be usable but are not tuned.
- Screen streaming (MediaMTX and the Moonlight gateway).
  Explicitly deferred past v1.
- Embedding Tailscale.
  The app assumes the user's device is already on the tailnet or the private network.

## 3. What the app talks to

wmux exposes a clean, well-separated contract that a native client can consume unchanged.
The canonical definitions live in `../wmux/src/shared/protocol.ts` and its shared type-only imports.

| Surface                                                                                  | Purpose                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/bootstrap`                                                                     | Full `BootstrapPayload`: machines, workspaces, tabs, panes, layout, notifications, agent events, runs, settings, streams |
| `POST /api/login`                                                                        | Username and password exchange for a bearer token                                                                        |
| `GET /api/auth-info`                                                                     | Whether auth and password login are enabled                                                                              |
| REST `/api/workspaces`, `/api/tabs`, `/api/panes`, `/api/settings`, `/api/notifications` | Mutations, each returning updated state                                                                                  |
| `WS /ws/events`                                                                          | `EventServerMessage`: `snapshot`, `delta`, `health`, `notification`, `media`, `clipboard`                                |
| `WS /ws/panes/:paneId`                                                                   | `PaneClientMessage` in, `PaneServerMessage` out: `starting`, `ready` with replay, `output`, `title`, `exit`, `removed`   |

Authentication is a bearer token in the `authorization` header for REST, and a `?token=` query parameter for WebSockets, because WebSockets cannot send headers.

Two properties matter enormously for a mobile client and are already true:

1. Closing or backgrounding a client does not kill a pane.
   Only an explicit close of a pane, tab, or workspace does.
2. Reattach is cheap and correct.
   `PaneServerMessage.ready` carries `replay` plus `replayKind` of `raw` or `checkpoint`, so a suspended app can resume without a visible reset.

Those two facts are what make aggressive mobile lifecycle management safe.

## 4. Architecture

### 4.1 Shape

React Native owns everything except the terminal cell grid.
A single offline WebView hosts `ghostty-web` as a pure VT canvas.

```
┌─ React Native ─────────────────────────────────┐
│  workspace drawer · tab bar · pane toolbar     │
│  ┌─ WebView (terminal host, local asset) ───┐  │
│  │   ghostty-web WASM · cell grid canvas    │  │
│  │   owns WS /ws/panes/:paneId              │  │
│  │   owns terminal-input.ts key encoding    │  │
│  │   owns kitty graphics overlays           │  │
│  └──────────────────────────────────────────┘  │
│  native selection handles · magnifier          │
│  native key accessory bar (Esc Tab Ctrl ↑↓←→)  │
└────────────────────────────────────────────────┘
   native: REST · /ws/events · keychain · push
           clipboard · gestures · keyboard · IME
```

### 4.2 Why this split

The WebView is not "the web app in a wrapper."
It is a single-purpose rendering surface with no navigation, no browser chrome, no network origin, and no focus.
It loads from a bundled local asset, never from the network.

This preserves, at zero additional cost, the parts of wmux that took real work and that a native rewrite would regress:

- `ghostty-web` VT fidelity, including the vendored PR patch under `../wmux/vendor`.
- Ligature support (`terminal-ligatures.ts`).
- Kitty graphics placeholder overlays (`kitty-graphics.ts`).
- Checkpoint and raw replay handling.
- OSC 52 parsing (`terminal-osc52.ts`).
- Rectangular selection (`terminal-rectangular-selection.ts`).
- Key-to-VT-byte encoding (`terminal-input.ts`), which is subtle and easy to get wrong.

It also means one VT implementation across web and mobile.
A bug fixed in wmux is fixed here.

### 4.3 The critical rule: terminal bytes never cross the bridge

The WebView owns the pane WebSocket directly.
High-throughput terminal output goes socket to WASM inside the WebView and never touches the React Native bridge.

The bridge carries only low-frequency control messages.
This is the single most important performance decision in the project.
Do not "simplify" it later by moving the pane socket into React Native.

### 4.4 One WebView, many terminals

Do not create a WebView per pane.
Create exactly one WebView that hosts a terminal host module capable of holding up to `N` live `ghostty-web` terminal instances (default `N = 3`), displaying one at a time.

- Switching tabs is an `attach` or `show` bridge message, not a WebView lifecycle event.
- WASM is initialized once.
- Background panes beyond `N` are evicted; the server keeps their sessions alive and reattach replays.
- On mobile, split panes collapse to the active pane, matching the web client's mobile behavior.

## 5. Repository layout

```
wmux-mobile/
  app/                      Expo Router routes (screens)
  src/
    api/                    REST client, typed against the shared protocol
    events/                 /ws/events client, reconnect, backoff, resync
    state/                  Store, reducers, optimistic mutation + reconcile
    terminal/
      bridge.ts             Typed bridge message union + codec
      TerminalSurface.tsx   RN component wrapping the WebView
      host/                 The WebView payload (its own Vite build)
        index.html
        host.ts             ghostty-web setup, pane socket, bridge endpoint
        vendor/             ghostty-web tarball (mirrored from wmux)
    input/                  Key event capture, IME, accessory bar
    clipboard/              Native clipboard + OSC 52 plumbing
    chat/                   Agent/Chat surface
    notifications/          Local + push registration, deep links
    ui/                     Shared native components, theme, color schemes
  modules/
    wmux-key-input/         Native module: raw key + IME capture (iOS + Android)
  protocol/                 Vendored copy of wmux's shared protocol + drift check
  e2e/                      Maestro flows
  test/                     Unit tests
  scripts/
    sync-protocol.mjs       Pull + verify protocol parity with ../wmux
    sync-ghostty.mjs        Pull the vendored ghostty-web tarball
  AGENTS.md
  README.md
  PLAN.md
```

## 6. Toolchain

- React Native via Expo with a development build (`expo prebuild`), not Expo Go.
  Custom native modules are required, so Expo Go is not viable.
- TypeScript, strict mode, matching wmux's `tsconfig.json` strictness.
- Expo Router for navigation.
- `react-native-gesture-handler` and `react-native-reanimated` for the drawer and selection gestures.
- `react-native-keyboard-controller` for exact keyboard frame and animation curve.
- `react-native-webview` for the terminal host.
- `expo-secure-store` for the token (Keychain on iOS, Keystore-backed on Android).
- `expo-notifications` for local and remote notifications.
- Vite for the terminal host bundle, mirroring wmux's `scripts/build-client.mjs` approach.

## 7. Protocol sharing

The mobile app must not drift from the server contract.

1. `../wmux/src/shared/protocol.ts` and its shared type-only imports remain the single source of truth.
2. `scripts/sync-protocol.mjs` copies the complete type boundary into `protocol/` with generated headers and records the source commit SHA in `protocol/SOURCE`.
3. CI fails if the vendored copy differs from the pinned wmux commit, and a scheduled job opens an issue when wmux `main` moves ahead.
4. Add a `PROTOCOL_VERSION` integer constant to wmux's shared protocol and serve it from a new `GET /api/protocol`.
   The app checks it at connect time and shows an explicit "update required" screen on mismatch rather than failing in confusing ways.

Do not hand-edit `protocol/`.

## 8. The terminal host contract

This is the most important interface in the project.
Specify it once, test it in isolation, and keep it stable.

The host bundle is an ordinary web page.
It can and must be tested headlessly with Playwright, against a mock pane WebSocket server, before any React Native integration exists.

### 8.1 Native to host

```ts
type ToHost =
  | { t: "init"; serverUrl: string; token: string; settings: HostSettings }
  | { t: "attach"; paneId: string }
  | { t: "show"; paneId: string }
  | { t: "detach"; paneId: string }
  | { t: "viewport"; paneId: string; widthPx: number; heightPx: number; dpr: number }
  | { t: "claimResize"; paneId: string }
  | { t: "key"; paneId: string; key: string; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
  | { t: "text"; paneId: string; data: string }
  | { t: "paste"; paneId: string; text: string }
  | { t: "scroll"; paneId: string; deltaLines: number; xPx: number; yPx: number }
  | { t: "scrollToBottom"; paneId: string }
  | { t: "activateLink"; paneId: string; requestId: string; xPx: number; yPx: number }
  | {
      t: "selection";
      paneId: string;
      action: "start" | "move" | "end" | "clear" | "word" | "line" | "all";
      xPx?: number;
      yPx?: number;
    }
  | { t: "copySelection"; paneId: string }
  | { t: "settings"; settings: HostSettings };
```

`HostSettings` mirrors the relevant fields of `WmuxSettings`: `terminalFontSize`, `terminalScrollbackRows`, `colorScheme`, `tuiFrameRate`, `terminalScrollMode`.

`scroll` coordinates are terminal-relative pixels identifying the touched cell; the host uses them when a mouse-tracked terminal application needs wheel input.

Note that input is **semantic**, not pre-encoded.
Native sends `{ key: "ArrowUp", ctrl: true }`; the host runs it through wmux's `terminal-input.ts` to produce VT bytes.
This keeps exactly one key encoder in existence and guarantees parity with the desktop web client.
`{ t: "text" }` carries IME-committed or accessory-bar literal text.

### 8.2 Host to native

```ts
type ToNative =
  | { t: "ready" }
  | { t: "pane"; paneId: string; state: "connecting" | "live" | "lost" | "exited"; issue?: string }
  | { t: "metrics"; paneId: string; cols: number; rows: number; cellW: number; cellH: number }
  | { t: "title"; paneId: string; title: string }
  | { t: "bell"; paneId: string }
  | { t: "osc52"; paneId: string; text: string }
  | { t: "altScreen"; paneId: string; active: boolean }
  | { t: "mouseTracking"; paneId: string; active: boolean }
  | { t: "cursor"; paneId: string; xPx: number; yPx: number; visible: boolean }
  | { t: "selection"; paneId: string; active: boolean; startPx?: Point; endPx?: Point; text?: string }
  | { t: "link"; paneId: string; requestId: string; url?: string }
  | { t: "media"; paneId: string; name: string; mimeType: string; dataUrl: string }
  | { t: "exit"; paneId: string; code: number | null }
  | { t: "log"; level: "debug" | "warn" | "error"; message: string };
```

### 8.3 Resize ownership

Native computes the pixel box (it knows safe areas, the drawer, the toolbar, and the exact keyboard frame).
The host measures cell metrics from the loaded font and derives `cols` and `rows`.
The host sends the `resize` on the pane socket itself and reports `metrics` back to native for display.
When the user focuses native terminal input, `claimResize` promotes the mobile pane socket to resize owner without sending terminal bytes.
This ensures another attached client cannot leave the phone displaying a PTY frame sized for a desktop.

This is a strict improvement over the web client's `mobile-viewport.ts`, which infers keyboard state from `visualViewport` deltas with tolerance heuristics.
Native gets the real number from `keyboardWillChangeFrame` and the Android insets API.

### 8.4 Non-goals for the host

The host renders the terminal grid and the kitty graphics overlays and nothing else.
Per wmux's convention, the terminal content area stays visually untreated.
All product styling, toolbars, shelves, and overlays are native.

## 9. Input subsystem

This is where the app earns its existence.
Budget real time here.

Implement `modules/wmux-key-input`, a native module exposing an invisible, always-available text input that the WebView never competes with.

### iOS

- `UITextInput`-conforming view, or a `UITextView` subclass.
- `autocorrectionType = .no`, `spellCheckingType = .no`, `smartQuotesType = .no`, `smartDashesType = .no`, `smartInsertDeleteType = .no`, `autocapitalizationType = .none`.
  Together these suppress the predictive bar that a web page cannot remove.
- `inputAssistantItem.leadingBarButtonGroups = []` and `trailingBarButtonGroups = []` to strip the iPad shortcuts bar.
- A custom `inputAccessoryView` hosting the wmux key bar: `Esc`, `Tab`, `Ctrl`, `Alt`, arrows, and the characters that are painful on a phone keyboard (`|`, `/`, `~`, `-`, `_`, backtick).
  `Ctrl` and `Alt` are sticky modifiers with a clear pressed state and a double-tap lock.
- `pressesBegan`/`pressesEnded` and `UIKeyCommand` for hardware keyboards, giving real `Ctrl`, `Alt`, `Esc`, and function keys.
- Marked-text (IME) states are held natively and only committed text is sent as `{ t: "text" }`.

### Android

- A `View` with `onCreateInputConnection` returning a `BaseInputConnection`.
- `EditorInfo.inputType = TYPE_CLASS_TEXT | TYPE_TEXT_FLAG_NO_SUGGESTIONS | TYPE_TEXT_VARIATION_VISIBLE_PASSWORD` to suppress the suggestion strip and autocorrect.
- `imeOptions |= IME_FLAG_NO_EXTRACT_UI | IME_FLAG_NO_FULLSCREEN` so landscape does not open the fullscreen extract editor.
- `onKeyDown`/`onKeyUp` for hardware keys and the volume-key-as-Ctrl affordance if desired.
- The accessory bar is a normal React Native view positioned with `react-native-keyboard-controller` insets, since Android has no `inputAccessoryView`.

### Rules

- The WebView must never take focus.
  Set it non-focusable, and route all touches through native gesture handlers.
  A WebView that raises the keyboard is a bug.
- Alt-as-Meta must be configurable, matching wmux's Option/Alt word-movement behavior.
- Key repeat is native and rate-limited.

Acceptance: with the app focused and a shell attached, no predictive bar, no autocorrect, no autocapitalization, and no smart punctuation appears on either platform, in portrait or landscape, with any of the three most common third-party keyboards installed.

## 10. Gestures and navigation

- Edge swipe from the left opens the workspace drawer, implemented with `react-native-gesture-handler`.
  Disable the iOS interactive pop gesture on the terminal screen so it cannot compete.
  There is no browser back gesture to fight.
- The drawer uses dense TUI-inspired workspace rows with normalized active-pane CWD, agent-state glyphs, and unread alert badges.
  Generic shell labels and decorative terminal icons are omitted.
- Horizontal swipe on the terminal switches tabs when the terminal is not in alternate-screen mode.
  When `altScreen` is active, the gesture is disabled so it does not fight a full-screen TUI.
- Vertical drag scrolls scrollback with native momentum and a rubber-band at the top.
  Pull past the bottom snaps to live.
- A single tap resolves OSC 8 and plain web links at the touched terminal cell before falling back to keyboard focus.
  Link navigation is performed by the native OS, while the WebView remains non-focusable.
- Long press starts selection with a native magnifier and draggable handles, using `cursor` and `selection` messages from the host for geometry.
  Double tap selects a word, triple tap selects a line.
- Bottom sheet replaces the desktop command palette: new tab, new workspace, split, close, host picker, settings, diagnostics.

## 11. Clipboard

Native clipboard access is unrestricted, which is the whole point.

- OSC 52 out: host emits `{ t: "osc52" }`, native writes to the system clipboard immediately, with a toast.
  No permission prompt, no user gesture requirement, no fallback button.
- Paste in: native reads the clipboard and sends `{ t: "paste" }`.
  On iOS 16 and later, programmatic reads can show a paste confirmation, so trigger reads only from an explicit user tap, and prefer `UIPasteControl` where it fits the design.
- Bracketed paste is handled in the host, as it already is in wmux.
- `POST /api/clipboard` handoff (`wmux-copy`, `wclip`) arrives over `/ws/events` as a `clipboard` message and is written natively without the top-bar fallback the browser needs.
- Image paste and attachment upload reuse `POST /api/panes/:paneId/paste-images` and `/attachments`, sourced from the native photo picker and share sheet.

## 12. Lifecycle and connectivity

- Backgrounding closes pane sockets deliberately rather than letting the OS kill them mid-write.
  The event socket is closed too.
- Foregrounding reconnects with bounded exponential backoff, refetches `/api/bootstrap`, and reattaches the visible pane.
  `replayKind: "checkpoint"` restores the screen without a visible reset.
- Follow wmux's existing rule: keep an already-loaded workspace mounted through a transient bootstrap failure, retry with backoff, and reserve the login surface for an explicit 401.
  Do not promote a network blip to a fatal overlay.
- Network change (cellular to Wi-Fi, tailnet up or down) triggers an immediate reconnect attempt rather than waiting out the backoff.
- A persistent, non-alarming connection banner shows `connecting`, `online`, or `offline`.
- iOS App Transport Security: Tailscale MagicDNS hosts serve Let's Encrypt certificates and need no exception.
  Support a user-supplied pinned certificate for self-signed deployments, and require an explicit, clearly-labeled opt-in for cleartext `http://` on a private address.
  Never ship a blanket ATS exception.

## 13. Server-side work in the wmux repo

These are additive and land as separate, reviewable changes in `../wmux`.
They must not regress the browser client.

| Change                    | Detail                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/protocol`       | Returns `{ protocolVersion, serverVersion }`. Add `PROTOCOL_VERSION` to `src/shared/protocol.ts`.                                                                                                                                                                                     |
| `POST /api/pair`          | Creates a short-lived, single-use pairing code. A CLI helper (`scripts/wmux-pair`) prints it as a QR encoding `{ url, code }`. The app exchanges the code for a device token. This replaces manual URL and token typing on a phone keyboard.                                          |
| `POST /api/devices`       | Registers an APNs or FCM token against a device-scoped credential. Returns a device id.                                                                                                                                                                                               |
| `DELETE /api/devices/:id` | Revocation, surfaced in wmux settings as a device list.                                                                                                                                                                                                                               |
| Push dispatch             | When a `TerminalNotification` is created, deliver it to registered devices via APNs and FCM in addition to the existing `/ws/events` broadcast. Outbound-only, so a tailnet-private server reaches Apple and Google fine even though the device cannot reach the server while asleep. |
| Device-scoped tokens      | Per-device credentials that can be revoked individually, instead of handing a phone the broad shared bearer token. This also chips at a limitation wmux's own docs already flag.                                                                                                      |

Push privacy: notification payloads traverse Apple and Google infrastructure.
Default to content-minimal payloads (workspace name and status only, never command text or titles), with an explicit opt-in setting for full content.
Document this in wmux's README next to the notification feature, per wmux's convention of documenting limitations near the feature.

## 14. Feature scope for v1

In scope:

1. **Terminal, workspaces, tabs, panes.**
   Attach and detach, replay, resize, scrollback, selection, copy and paste, key accessory bar, workspace drawer, tab bar, host picker, split panes collapsed to the active pane.
2. **Agent and Chat surface.**
   Native port of `MobileAgentSurface.tsx`: a merged thread of agent events, runs, and notifications, a composer with image attachments, and agent launcher actions.
   On a phone this is often the better surface than a raw terminal, and it should be a first-class peer, not a secondary tab.
3. **Notifications and activity.**
   Notification center, unread badges per workspace and tab, deep link into the originating pane, and background push once the server work lands.

Deferred:

- Screen streaming, both MediaMTX and Moonlight.
- Machine and dynamic-registry editing.
- Retro boot artwork and the WebGL empty-workspace shader.
  Ship a simple, well-made native empty state instead.
- Tablet-tuned multi-pane layouts.

## 15. Milestones

Each milestone ends with its acceptance criteria met and CI green.

### M0. Foundations

Expo project with a development build, strict TypeScript, ESLint and Prettier matched to wmux, `scripts/sync-protocol.mjs`, `scripts/sync-ghostty.mjs`, `AGENTS.md`, and CI running typecheck, lint, and unit tests on every push.

Accept: `npm run check` passes; a development build installs on an iOS simulator and an Android emulator.

### M1. Connectivity and auth

Pairing screen (QR scan plus manual entry fallback), token in SecureStore, `/api/bootstrap`, `/ws/events` client with reconnect and resync, connection banner, protocol-version handshake, explicit 401 handling.

Accept: the app connects to a real wmux server over Tailscale, lists workspaces, tabs, panes, and machines, and survives airplane-mode toggling and a server restart without a fatal state.

### M2. Terminal host bundle, standalone

Build the host page and test it under Playwright against a mock pane WebSocket, with no React Native involved.
Covers: WASM init, attach, replay of both `raw` and `checkpoint`, output rendering, `resize` derivation from a pixel box, key encoding via `terminal-input.ts`, OSC 52 emission, alternate-screen detection, kitty graphics overlays.

Accept: the full bridge contract in section 8 is implemented and covered by headless tests; a golden-image test renders a known VT fixture identically to the wmux web client.

### M3. Terminal surface in React Native

Embed the host in a single non-focusable WebView, wire the typed bridge, implement the terminal pool with `N = 3`, attach on tab switch, exact pixel-box computation from safe areas and layout.

Accept: a live shell renders and updates on a physical iPhone and a physical Android phone; rotating the device resizes correctly within one frame of the rotation animation completing.

### M4. Input subsystem

`modules/wmux-key-input` on both platforms, accessory bar, sticky modifiers, hardware keyboard, IME, key repeat.

Accept: the criteria in section 9.
Additionally, `htop`, `vim`, `tmux` prefix keys, and a Claude Code or Codex session are all fully drivable from a phone without an external keyboard.

### M5. Chrome and navigation

Workspace drawer with edge swipe, tab bar, pane toolbar, host picker, bottom-sheet action menu, settings, diagnostics, theming across all seven `TERMINAL_COLOR_SCHEME_IDS` with the native chrome matching.

Accept: every REST mutation in `../wmux/src/client/src/api.ts` that v1 needs is reachable from the UI; layout is correct on iPhone SE through iPhone Pro Max and on a small Android phone, in portrait and landscape, with safe areas respected.

### M6. Selection and clipboard

Long-press selection with magnifier and handles, word and line selection, OSC 52 both directions, paste, `/api/clipboard` handoff, image paste and attachment upload.

Accept: copying from a terminal and pasting into another app works, and the reverse works, with no permission prompt beyond the unavoidable iOS paste confirmation.

### M7. Agent and Chat surface

Native thread view, composer, attachments, launchers, unread state, deep links into panes.

Accept: an agent session started from the app is fully usable from the Chat surface, including sending images.

### M8. Notifications and push

Server work from section 13, device registration, local notifications while foregrounded, background push, deep links, per-workspace and per-tab badges, notification settings including the content-minimal default.

Accept: a `wmux-notify` call on a remote host produces a notification on a locked phone that deep-links to the correct pane.

### M9. Hardening

Lifecycle edge cases, memory under long sessions and large scrollback, jetsam avoidance on iOS, Android WebView version gating with a clear message, battery and thermal behavior under a busy TUI, accessibility (Dynamic Type in chrome, VoiceOver labels, reduced motion), and a pixel-level design pass.

Accept: a two-hour session with a busy TUI holds steady memory and does not thermally throttle; no layout defect survives the design pass.

### M10. Release

EAS Build profiles for development, preview, and production; TestFlight and Play internal testing; crash and error reporting; a versioning scheme tied to wmux's protocol version.

Accept: a signed build is installable from TestFlight and the Play internal track.

## 16. Testing strategy

wmux's engineering standard applies here.
Lint failures, test failures, and flakiness get fixed even when unrelated to the current change.

- **Host bundle**: Playwright against the built host page with a mock pane WebSocket server.
  This is the highest-leverage test layer because the terminal is where correctness matters most and it is fully headless-testable.
- **Key encoding parity**: a shared fixture table of key events to expected VT bytes, asserted against the same `terminal-input.ts` the wmux web client uses.
- **Protocol drift**: CI fails when `protocol/` diverges from the pinned wmux commit.
- **Unit**: Jest for the store, reducers, optimistic mutation and reconcile, backoff, and bridge codec.
- **Component**: React Native Testing Library for chrome and the Chat surface.
- **E2E**: Maestro flows on an iOS simulator and an Android emulator, run against a real wmux server started in CI on loopback with a `local` machine.
  Flows: pair, open workspace, run a command, switch tabs, open the drawer by swipe, copy output, paste, send a chat message, receive a notification.
- **Golden screenshots**: fixed device sizes, both orientations, keyboard open and closed, for each color scheme.
- **Device matrix**: iPhone SE (small, no Dynamic Island), a current iPhone Pro (Dynamic Island safe areas), a mid-range Android phone, and one foldable.

## 17. Risks and mitigations

| Risk                                                         | Mitigation                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebView steals focus and raises the keyboard                 | Make the WebView non-focusable; route all touches through native gesture handlers; assert in E2E that the keyboard only appears when the native input is focused      |
| iOS memory pressure from WASM plus large scrollback          | Cap the terminal pool at `N`, bound `terminalScrollbackRows` on mobile, rely on checkpoint replay rather than holding history client-side, and test under Instruments |
| Android WebView fragmentation                                | Detect the WebView version at startup, gate below a known-good version with an actionable message, and include the version in diagnostics                             |
| Bridge becomes a bottleneck                                  | Enforce the rule in section 4.3 in code review; add a CI assertion that no `output`-shaped message type exists in the bridge union                                    |
| Push payloads leak terminal content through Apple and Google | Content-minimal default, explicit opt-in for full content, documented in wmux's README                                                                                |
| Tailscale not running on the device                          | Detect connection failure to a `*.ts.net` host and show a specific, actionable message rather than a generic network error                                            |
| Protocol drift between repos                                 | Vendored protocol plus CI parity check plus the version handshake                                                                                                     |
| Divergence between the web mobile surface and the native app | Treat `../wmux`'s mobile web path as a supported fallback, not a second product; when behavior differs deliberately, document it in both repos                        |

## 18. First actions for the implementing agent

1. Read `../wmux/AGENTS.md` in full, then `src/shared/protocol.ts`, `src/client/src/terminal-input.ts`, `src/client/src/terminal-pane-runtime.ts`, `src/client/src/TerminalPane.tsx`, and `src/client/src/MobileAgentSurface.tsx`.
2. Stand up a local wmux server with a `local` machine and confirm the REST and WebSocket surfaces by hand before writing any client code.
3. Execute M0, then M2 before M1 if that keeps momentum; the host bundle is independently testable and de-risks the largest unknown.
4. Do not begin M4 until M3 is stable on physical hardware.
   Input work on a simulator is misleading.
