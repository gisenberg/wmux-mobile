# TestFlight delivery

The TestFlight workflow runs only when manually dispatched from GitHub Actions.
It uses the dedicated `wmux-mobile` registration on the shared Away-Team Mac, runs the full project gate, creates a clean Expo iOS project, archives and signs the release with Xcode, validates the IPA, and uploads it to App Store Connect.

## Repository secrets

The repository must define these Actions secrets:

- `ASC_APP_ID`
- `APPLE_TEAM_ID`
- `ASC_API_KEY_ID`
- `ASC_API_KEY_ISSUER_ID`
- `ASC_API_PRIVATE_KEY`

`ASC_API_PRIVATE_KEY` may contain the PEM file verbatim or its base64 representation.
The workflow materializes it under `RUNNER_TEMP`, gives it owner-only permissions, and removes it in an always-running cleanup step.
No Apple credential is stored in the repository or build artifacts.

## Runner

The workflow selects a self-hosted runner with the standard `self-hosted`, `macOS`, and `ARM64` labels plus the custom `wmux-mobile` label.
The runner needs Xcode, CocoaPods, Node.js bootstrap access, RTK, an Apple Distribution identity for the configured team, and network access to npm, CocoaPods, GitHub, and Apple.

The App Store provisioning profile is created or refreshed by Xcode automatic signing through the App Store Connect API key.
The runner registration is repository-scoped, so the shared Mac uses a separate runner service for each GitHub repository.

## Versioning

The user-facing version comes from `expo.version` in `app.json`.
Before every archive, the workflow queries the latest uploaded App Store Connect build and increments its build number.
The workflow writes neither version back to the source tree.

## Deployment

Open the repository Actions page, select **TestFlight**, and choose **Run workflow**.
The concurrency guard allows one TestFlight delivery at a time and never cancels an upload in progress.

After Apple accepts the upload, processing continues in App Store Connect.
An internal TestFlight group with automatic distribution enabled receives processed builds without an additional workflow step.
External testing still requires Apple beta review and the appropriate TestFlight metadata.
