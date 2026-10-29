import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:gatelens_companion/checkpoint/checkpoint_api.dart';
import 'package:gatelens_companion/checkpoint/checkpoint_controller.dart';
import 'package:gatelens_companion/display/display_bridge.dart';
import 'display_controller_test.dart' show FakeDisplayBridge;

class FakeApi implements CheckpointApi {
  int revision = 1, time = 1000, version = 1;
  bool scanned = true, offline = false, photoFails = false;
  String decision = 'valid', step = 'ready', assessmentStatus = 'readable';
  final calls = <String>[];
  Completer<Map<String, dynamic>>? pendingRead;
  Map<String, dynamic> snapshot() => {
    'revision': revision,
    'startedAt': revision * 100,
    'serverTime': time,
    'entry': {
      'licence': 'HZ27KLGP',
      'company': 'Cedar Logistics',
      'profileName': 'Dispatch',
    },
    'decision': decision,
    'reason': 'Demo $decision',
    'presentation': {
      'direction': 'EXIT',
      'driver': 'A. Morgan',
      'destination': 'Cold store B',
      'trailer': 'KT18NBGP',
    },
    'event': scanned ? {} : null,
    'openedAt': 0,
    'inspection': {
      'id': 'INS-1',
      'version': version,
      'step': step,
      'expectedSeal': 'CG-24081',
      'observedSeal': 'CG-24089',
      'sealMatches': false,
      'flow': 'compare',
      'assessment': {
        'status': assessmentStatus,
        'confidence': 95,
        'number': 'CG-24089',
      },
      'photo': ['photo_review', 'review', 'incident'].contains(step)
          ? {'id': 'photo-1'}
          : null,
      'incident': step == 'incident'
          ? {'id': 'INC-1234567890', 'status': 'Open'}
          : null,
    },
  };
  @override
  Future<Map<String, dynamic>> state() async {
    if (offline) throw StateError('offline');
    return pendingRead?.future ?? snapshot();
  }

  @override
  Future<String> photo(String id) async {
    if (photoFails) throw StateError('photo unavailable');
    return 'cGhvdG8=';
  }

  @override
  Future<Map<String, dynamic>> command(
    String action,
    Map<String, dynamic> body,
  ) async {
    if (offline) throw StateError('offline');
    if (action == 'scan') {
      if (body['revision'] != revision || time - revision * 100 < 4500) {
        throw StateError('truck not ready or stale');
      }
      calls.add(action);
      scanned = true;
      return snapshot();
    }
    if (body['revision'] != revision || body['inspectionVersion'] != version) {
      throw StateError('stale');
    }
    calls.add(action);
    version++;
    step = {
      'inspection/start': 'trailer',
      'inspection/trailer': 'seal',
      'inspection/report': 'issue_review',
      'inspection/capture': 'photo_pending',
      'inspection/accept-photo': 'review',
      'inspection/submit': 'incident',
    }[action]!;
    return snapshot();
  }

  @override
  void close() {}
}

void main() {
  late FakeDisplayBridge bridge;
  late FakeApi api;
  late CheckpointController controller;
  setUp(() {
    bridge = FakeDisplayBridge();
    api = FakeApi();
    controller = CheckpointController(
      bridge,
      api,
      pollInterval: const Duration(days: 1),
    );
  });
  tearDown(() => controller.dispose());
  test(
    'temporary SDK rendering error retries without a business command',
    () async {
      bridge.failRender = true;
      Timer(const Duration(milliseconds: 50), () => bridge.failRender = false);
      await controller.start();
      expect(controller.error, isNull);
      expect(bridge.cards.single.actions.single.id, 'start');
      expect(bridge.starts, 1);
      expect(api.calls, isEmpty);
    },
  );
  Future<void> select(String id) async {
    bridge.events.add(DisplaySelection(id, bridge.cards.last.revision));
    await Future<void>.delayed(Duration.zero);
  }

  test('check for truck waits for arrival then loads the assignment', () async {
    api.scanned = false;
    await controller.start();
    expect(bridge.cards.last.title, 'Truck approaching');
    expect(bridge.cards.last.actions.single.id, 'refresh');
    await select('scan');
    expect(api.calls, isEmpty);
    api.time = 5000;
    await controller.refresh();
    expect(bridge.cards.last.actions.single.label, 'Check for truck');
    await select('scan');
    expect(api.calls, ['scan']);
    expect(api.scanned, isTrue);
    expect(api.step, 'ready');
    expect(bridge.cards.last.actions.single.id, 'start');
  });

  test(
    'checking a blocked truck displays the denial without starting inspection',
    () async {
      api.scanned = false;
      api.time = 5000;
      api.decision = 'blocked';
      await controller.start();
      await select('scan');
      expect(api.calls, ['scan']);
      expect(bridge.cards.last.subtitle, contains('Inspection unavailable'));
      expect(bridge.cards.last.actions.single.id, 'refresh');
    },
  );

  test(
    'official actions traverse inspection and create an incident without opening',
    () async {
      await controller.start();
      for (final id in ['start', 'trailer', 'capture']) {
        await select(id);
      }
      expect(api.step, 'photo_pending');
      api.step = 'photo_review';
      api.version++;
      await controller.refresh();
      expect(bridge.cards.last.imageBase64, isNotNull);
      await select('accept-photo');
      expect(bridge.cards.last.actions.single.label, 'Create incident');
      await select('submit');
      expect(bridge.cards.last.title, 'HOLD / Seal mismatch');
      expect(api.calls.any((c) => c.startsWith('open')), isFalse);
    },
  );
  test('duplicate and old-card callbacks cannot skip a step', () async {
    await controller.start();
    final old = bridge.cards.last.revision;
    await select('start');
    bridge.events.add(DisplaySelection('trailer', old));
    await Future<void>.delayed(Duration.zero);
    expect(api.calls, ['inspection/start']);
    await select('submit');
    expect(api.calls.length, 1);
  });
  test(
    'selection waits for a poll but revalidates the rendered card',
    () async {
      await controller.start();
      final pending = Completer<Map<String, dynamic>>();
      api.pendingRead = pending;
      final polling = controller.refresh();
      bridge.events.add(DisplaySelection('start', bridge.cards.last.revision));
      expect(api.calls, isEmpty);
      api.pendingRead = null;
      pending.complete(api.snapshot());
      await polling;
      await Future<void>.delayed(Duration.zero);
      expect(api.calls, ['inspection/start']);
    },
  );
  test('scenario change invalidates old callbacks', () async {
    await controller.start();
    final old = bridge.cards.last.revision;
    api.revision++;
    api.decision = 'blocked';
    await controller.refresh();
    bridge.events.add(DisplaySelection('start', old));
    await Future<void>.delayed(Duration.zero);
    expect(api.calls, isEmpty);
    expect(bridge.cards.last.status, 'blocked');
  });
  test('offline pause resumes authoritative step', () async {
    await controller.start();
    await select('start');
    api.offline = true;
    await controller.refresh();
    expect(bridge.cards.last.status, 'offline');
    await select('trailer');
    expect(api.calls.length, 1);
    api.offline = false;
    await controller.refresh();
    expect(bridge.cards.last.title, contains('Check trailer'));
  });
  test(
    'unavailable photo cannot be accepted; reload restores evidence',
    () async {
      api.step = 'photo_review';
      api.photoFails = true;
      await controller.start();
      expect(
        bridge.cards.last.actions.any((a) => a.id == 'accept-photo'),
        isFalse,
      );
      await select('accept-photo');
      expect(api.calls, isEmpty);
      api.photoFails = false;
      await select('refresh');
      expect(bridge.cards.last.imageBase64, isNotNull);
      expect(bridge.cards.last.actions.first.id, 'accept-photo');
    },
  );
  test(
    'polling unchanged state preserves focus; stopped actions are ignored',
    () async {
      await controller.start();
      final count = bridge.cards.length;
      api.time += 700;
      await controller.refresh();
      expect(bridge.cards.length, count);
      final rev = bridge.cards.last.revision;
      await controller.stop();
      bridge.events.add(DisplaySelection('start', rev));
      await Future<void>.delayed(Duration.zero);
      expect(api.calls, isEmpty);
    },
  );
  test(
    'photo retake clears cached preview and waits for new capture',
    () async {
      api.step = 'photo_review';
      await controller.start();
      expect(bridge.cards.last.imageBase64, isNotNull);
      await select('capture');
      expect(bridge.cards.last.imageBase64, isNull);
      expect(api.step, 'photo_pending');
    },
  );
  test(
    'uncertain OCR cannot be accepted and routes to manual review',
    () async {
      api.step = 'photo_review';
      api.assessmentStatus = 'unreadable';
      await controller.start();
      expect(
        bridge.cards.last.actions.any((a) => a.id == 'accept-photo'),
        isFalse,
      );
      await select('accept-photo');
      expect(api.calls, isEmpty);
      await select('report');
      expect(api.step, 'issue_review');
      expect(bridge.cards.last.actions.single.label, 'Create review incident');
    },
  );
}
