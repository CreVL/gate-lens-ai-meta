import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gatelens_companion/display/display_bridge.dart';
import 'package:gatelens_companion/display/display_card.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('dev.gatelens/test-display');
  test(
    'serializes cards and receives typed native selection callbacks',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return null;
          });
      final bridge = MethodChannelDisplayBridge(channel: channel);
      await bridge.start();
      await bridge.render(
        const DisplayCard(
          revision: 7,
          title: 'DEMO-001',
          subtitle: 'Synthetic',
          status: 'blocked',
          actions: [DisplayAction('details', 'View entry')],
        ),
      );
      expect(calls.map((call) => call.method), ['start', 'render']);
      expect(calls.last.arguments['revision'], 7);
      expect(calls.last.arguments['status'], 'blocked');
      final selection = bridge.selections.first;
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(
            channel.name,
            const StandardMethodCodec().encodeMethodCall(
              const MethodCall('selection', {
                'actionId': 'details',
                'revision': 7,
              }),
            ),
            (_) {},
          );
      final event = await selection;
      expect(event.actionId, 'details');
      expect(event.revision, 7);
      await bridge.dispose();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    },
  );
}
