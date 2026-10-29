# Flutter companion

The Dart controller turns Go inspection state into cards and forwards selections through a Kotlin MethodChannel adapter to Meta DAT 1.0.1. The current flow includes Check for truck, trailer confirmation, photo/number review, retake, registration and incidents.

Use the root [setup](../../README.md#start-locally) and [troubleshooting](../../docs/setup.md). This is an Android mock-device prototype; iOS and physical glasses are not implemented.

```powershell
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

The native adapter requires one to three actions per card; the test bridge mirrors that contract. Versioned callbacks prevent previous cards from changing the current step. A render retry repeats content, not business mutations. Stop/start creates a new session while retaining the activity's paired mock device.

The older static-card smoke test is available in `integration_test/display_smoke_test.dart`. It exercises the SDK preview DOM and the real native callback using a debug-only hook, not a physical input API. Release hardware provisioning and production distribution are outside this app.
