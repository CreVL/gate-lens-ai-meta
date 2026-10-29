import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:gatelens_companion/display/display_bridge.dart';
import 'package:gatelens_companion/display/display_card.dart';
import 'package:gatelens_companion/display/display_controller.dart';

class FakeDisplayBridge implements DisplayBridge {
  final events = StreamController<DisplaySelection>.broadcast(sync: true);
  final cards = <DisplayCard>[];
  int starts = 0;
  int stops = 0;
  bool failRender = false;
  @override
  Stream<DisplaySelection> get selections => events.stream;
  @override
  Future<void> start() async {
    starts++;
  }

  @override
  Future<void> render(DisplayCard card) async {
    if (failRender) throw StateError('Display disconnected');
    // Mirror the native adapter's contract so unsupported cards fail unit tests.
    if (card.actions.isEmpty || card.actions.length > 3) {
      throw StateError('A card needs one to three actions');
    }
    cards.add(card);
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> dispose() => events.close();
}

void main() {
  late FakeDisplayBridge bridge;
  late DisplayController controller;
  setUp(() {
    bridge = FakeDisplayBridge();
    controller = DisplayController(bridge);
  });
  tearDown(() => controller.dispose());

  test('starts once and sends a Dart card', () async {
    await controller.start();
    await controller.start();
    expect(bridge.starts, 1);
    expect(bridge.cards.single.title, 'DEMO-001');
    expect(controller.state, PreviewState.active);
  });

  test('rejects actions absent from the current card', () async {
    await controller.start();
    bridge.events.add(DisplaySelection('return', bridge.cards.last.revision));
    await Future<void>.delayed(Duration.zero);
    expect(controller.selectionCount, 0);
  });

  test(
    'ignores duplicate and stale callbacks after the card changes',
    () async {
      await controller.start();
      final revision = bridge.cards.last.revision;
      bridge.events.add(DisplaySelection('details', revision));
      bridge.events.add(DisplaySelection('details', revision));
      await Future<void>.delayed(Duration.zero);
      expect(controller.selectionCount, 1);
      expect(bridge.cards.last.title, 'Test entry');
      bridge.events.add(DisplaySelection('dismiss', revision));
      await Future<void>.delayed(Duration.zero);
      expect(controller.selectionCount, 1);
    },
  );

  test(
    'stopped session rejects callbacks and restart has a new revision',
    () async {
      await controller.start();
      final oldRevision = bridge.cards.last.revision;
      await controller.stop();
      bridge.events.add(DisplaySelection('details', oldRevision));
      await controller.start();
      bridge.events.add(DisplaySelection('details', oldRevision));
      await Future<void>.delayed(Duration.zero);
      expect(controller.selectionCount, 0);
      expect(bridge.cards.last.revision, greaterThan(oldRevision));
    },
  );

  test(
    'render failure releases the native session and can be retried',
    () async {
      bridge.failRender = true;
      await controller.start();
      expect(controller.state, PreviewState.failed);
      expect(controller.error, contains('Display disconnected'));
      expect(bridge.stops, 1);
      bridge.failRender = false;
      await controller.start();
      expect(controller.state, PreviewState.active);
    },
  );
}
