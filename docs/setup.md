# Setup and troubleshooting

Use the root README for the two launch modes. `node`, `pnpm`, `go` and `flutter` should resolve in the terminal before starting. The launchers support common Go/FVM locations; they do not depend on an editor's private runtime.

## Android connection

```powershell
adb -s emulator-5554 reverse tcp:9010 tcp:9010
adb -s emulator-5554 forward tcp:9000 tcp:9000
```

Reverse lets Android reach the host's Go service; forward exposes the SDK's preview server. Keep the companion running. PowerShell requires `&` before a quoted executable path:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s emulator-5554 forward tcp:9000 tcp:9000
```

If testing a second Go instance on 9011, reverse Android 9010 to host 9011 and open that instance's `/glasses`. Restore the previous mapping after testing.

## Common cases

| Symptom | Action |
| --- | --- |
| Check for truck appears unchanged | Wait for the arrival card after changing scenarios, then select the new Check for truck button. A blocked job shows denial instead of Start inspection. |
| Extension install page, although installed | Enable the extension on the current origin; 9000 and 9010 are distinct origins. |
| Empty response or preview offline | Check the Android app session, ADB forwarding and Go server. Start/restart the preview, then refresh the browser. |
| OCR unavailable | Verify Node is on PATH and run `pnpm install --frozen-lockfile --ignore-scripts` in `apps/simulator`, then restart the server. |
| Photo never arrives | Keep the relevant 3D page visible and focused; other tabs must not capture unrelated viewpoints. Retry capture. |
| Number unreadable | Frame the label closer and more frontally; G gives a reference view. No expected-number substitution occurs. |
| Native card render fails | Restart the preview. GateLens retries a transient render once without repeating the business command. |
| Port 9010 occupied | Stop your known demo service or use another port for standalone. The linked launcher only replaces a recorded GateLens process. |

## Fresh dependency setup

From `apps/simulator`:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run prepare-assets
```

Tesseract's package postinstall is not required by this project. The language data comes from a pinned package. The generated local Three.js vendor directory includes its license and is ignored by Git.

From `apps/companion`, run `flutter pub get`, then `flutter analyze`, `flutter test`, and `flutter build apk --debug`. Flutter recreates ignored generated Android/Gradle wrapper files during setup/build. Android dependencies, SDK components and local caches are not bundled.

The mock-only app requires no real device registration or production credentials. `meta_developer_mode_id` is the mock placeholder `0`. Hardware registration, actual camera capture, physical gestures and field testing are separate future work.
