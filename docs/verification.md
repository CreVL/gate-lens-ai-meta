# Verification

Public-build verification completed on 2026-10-29 in a fresh source-only directory, with installed toolchains and shared dependency caches:

- Go tests and executable build passed.
- Flutter analysis and all 18 tests passed; the Android debug APK built from the fresh source tree.
- Four movement tests passed.
- Pixel-only OCR read both unseen numbers and rejected non-label/obscured examples.
- All six standalone browser jobs passed.
- Matching, mismatching, arrival and unreadable cases passed through the official Meta simulator and native callbacks, including wrong-view rejection and retake.
- Check for truck passed for normal and blocked jobs without walking mode.
- Browser checks kept the gate closed. Selected runtime screenshots were visually inspected.

The source tree was copied without generated dependencies or build output; it was not cloned from a published remote. After tests, the original development APK and ADB target were restored and the dedicated test server was stopped.

## Commands

```powershell
# services/access-demo
go test ./...

# apps/companion
flutter analyze
flutter test
flutter build apk --debug

# apps/simulator
pnpm install --frozen-lockfile --ignore-scripts
pnpm run prepare-assets
pnpm test
pnpm exec playwright install chromium
pnpm run test:vision
```

Start a dedicated demo service on 9011 before browser tests:

```powershell
$env:GATELENS_TEST_URL='http://127.0.0.1:9011'
pnpm run test:browser
```

For official display tests also start the companion, forward Android 9000, reverse Android 9010 to the tested Go port, and set `META_EXTENSION_PATH` to your installed unpacked extension directory. Then run `pnpm run test:meta` and `node test/check-truck.mjs`. Tests change scenarios; run them sequentially against a dedicated/shared-idle service. If `GATELENS_TEST_URL` is absent, they use 9010. Restore ADB reverse forwarding afterwards.

The pixel test reads numbers absent from the job catalogue (`QZ-86740`, `LM-15273`) and rejects non-label, wrong-label and obscured examples. Browser tests use actual scene pixels and real Tesseract. Backend unit tests use injected recognizers to exercise sequencing, uncertainty, reset/cancellation and authorization boundaries.

The Meta test uses an isolated headless Chromium profile and the installed unmodified extension. Screenshots and actual PNG evidence are stored in ignored `.artifacts/vision/`. Screenshots in `docs/media` are selected runtime results, not concept art.

Tests do not establish physical camera readability, optical comfort, hardware stability, production security or measured business benefit. Android SDK/Gradle and package caches may be reused during fresh-checkout testing; this is not a clean operating-system installation.
