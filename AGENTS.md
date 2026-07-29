# AGENTS.md

## Project

wmux-mobile is the native iOS and Android client for the adjacent `wmux` repository.
React Native owns product chrome, navigation, input, lifecycle, clipboard, and notifications.
A single non-focusable local WebView will own terminal rendering and pane WebSockets.
Terminal output bytes must never cross the React Native bridge.

Read `PLAN.md` and `../wmux/AGENTS.md` before changing architecture or wire contracts.

## Commands

- `npm install` installs dependencies.
- `npm run start` starts Metro for a development build.
- `npm run ios` creates and installs the iOS development build.
- `npm run android` creates and installs the Android development build.
- `npm run typecheck` runs strict TypeScript checks.
- `npm run lint` runs ESLint.
- `npm run format:check` checks Prettier formatting.
- `npm test` runs unit tests.
- `npm run check` runs every M0 validation gate.
- `npm run sync:protocol` vendors the adjacent wmux protocol at its current commit.
- `npm run sync:ghostty` vendors the adjacent wmux Ghostty Web package.

## Generated Sources

`../wmux/src/shared/protocol.ts` and its shared type-only imports are the only sources of truth for the server protocol.
Never hand-edit `protocol/wmux.ts`, `protocol/keybindings.d.ts`, or `protocol/SOURCE`.
Run `npm run sync:protocol` and commit all generated protocol files together.

Never hand-edit files under `src/terminal/host/vendor`.
Run `npm run sync:ghostty` and commit the generated package and source metadata together.

## Architecture Rules

- Keep Expo development builds as the supported development container.
- Expo Go is unsupported because the app requires custom native modules.
- Keep TypeScript strict.
- Keep terminal bridge messages low frequency and semantic.
- Keep credentials out of AsyncStorage, logs, generated files, fixtures, and source control.
- Preserve already-loaded state through transient network failures.
- Treat explicit HTTP 401 responses as authentication failures.
- Keep the WebView non-focusable when the terminal surface lands.
- Do not begin the native input milestone until the terminal surface is stable on physical iOS and Android hardware.

## Code Style

- Prefer small typed modules with explicit boundaries.
- Keep platform differences behind narrow interfaces.
- Use structured protocol objects instead of ad hoc strings.
- Keep comments sparse and focused on lifecycle, protocol, or platform behavior that is not obvious from the code.
- Do not commit generated native directories, build output, Metro state, coverage, or test results.
