import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:gatelens_companion/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const native = MethodChannel('dev.gatelens/display');

  Future<void> waitFor(WidgetTester tester, String text) async {
    final deadline = DateTime.now().add(const Duration(seconds: 35));
    while (find.text(text).evaluate().isEmpty &&
        DateTime.now().isBefore(deadline)) {
      if (find.text('Session: failed').evaluate().isNotEmpty) {
        final errors = tester
            .widgetList<SelectableText>(find.byType(SelectableText))
            .map((widget) => widget.data)
            .join('\n');
        fail('Native Meta session failed: $errors');
      }
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.text(text), findsOneWidget);
  }

  testWidgets(
    'official preview returns one Dart action across three fresh sessions',
    (tester) async {
      await tester.pumpWidget(const GateLensApp(linked: false));
      for (var cycle = 1; cycle <= 3; cycle++) {
        await tester.tap(find.byKey(const Key('start-preview')));
        await waitFor(tester, 'Session: active');
        var clicked = false;
        final deadline = DateTime.now().add(const Duration(seconds: 20));
        while (!clicked && DateTime.now().isBefore(deadline)) {
          clicked =
              await native.invokeMethod<bool>('debugSelectPrimary') ?? false;
          if (!clicked) await tester.pump(const Duration(milliseconds: 300));
        }
        expect(
          clicked,
          isTrue,
          reason: 'SDK preview must contain an actionable control',
        );
        await waitFor(tester, 'Actions received in Dart: $cycle');
        expect(find.text('Last action: details'), findsOneWidget);
        await tester.tap(find.byKey(const Key('stop-preview')));
        await waitFor(tester, 'Session: stopped');
      }
    },
  );
}
