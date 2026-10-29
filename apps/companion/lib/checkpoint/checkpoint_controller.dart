import 'dart:async';
import 'dart:convert';
import '../display/display_bridge.dart';
import '../display/display_card.dart';
import '../display/display_session.dart';
import 'checkpoint_api.dart';

/// One serialized interaction stream: Go is authoritative; SDK callbacks select actions.
class CheckpointController extends DisplaySession {
  CheckpointController(
    this._bridge,
    this._api, {
    this.pollInterval = const Duration(milliseconds: 700),
  }) {
    _subscription = _bridge.selections.listen(_select);
  }
  final DisplayBridge _bridge;
  final CheckpointApi _api;
  final Duration pollInterval;
  late final StreamSubscription<DisplaySelection> _subscription;
  Timer? _timer;
  CheckpointSnapshot? _snapshot;
  String? _image, _photoId;
  bool _disposed = false, _operation = false, _online = false;
  Completer<void>? _operationDone;
  int _generation = 0, _revision = 0;
  String _signature = '';
  String? _photoError;
  Set<String> _actions = {};
  @override
  PreviewState state = PreviewState.stopped;
  @override
  String? error;
  @override
  String lastAction = 'No display action received';
  @override
  int selectionCount = 0;
  @override
  bool get busy =>
      state == PreviewState.starting || state == PreviewState.stopping;

  bool _current(int generation) => !_disposed && generation == _generation;
  void _begin() {
    _operation = true;
    _operationDone = Completer<void>();
  }

  void _finish() {
    _operation = false;
    _operationDone?.complete();
    _operationDone = null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _accept(Map<String, dynamic> data) {
    final next = CheckpointSnapshot.fromJson(data);
    if (_snapshot?.identity != next.identity ||
        _snapshot?.inspection['photo']?['id'] !=
            next.inspection['photo']?['id']) {
      _image = null;
      _photoId = null;
      _photoError = null;
    }
    _snapshot = next;
    _online = true;
    error = null;
  }

  DisplayCard _card() {
    final s = _snapshot;
    DisplayCard card(
      String title,
      String subtitle,
      String status,
      List<DisplayAction> actions, {
      String? image,
    }) => DisplayCard(
      revision: _revision,
      title: title,
      subtitle: subtitle,
      status: status,
      actions: actions,
      imageBase64: image,
    );
    if (!_online || s == null) {
      return card(
        'Checkpoint offline',
        'Inspection paused.\nReconnect to resume the saved step.',
        'offline',
        const [DisplayAction('retry', 'Retry connection')],
      );
    }
    if (!s.scanned) {
      if (s.serverTime - s.startedAt < 4500) {
        return card(
          'Truck approaching',
          '${s.checkpoint}\nWait for the truck to stop at the checkpoint.',
          'waiting',
          const [DisplayAction('refresh', 'Refresh arrival')],
        );
      }
      return card(
        'Truck inspection',
        '${s.checkpoint}\nSelect Check for truck to load the demo assignment.',
        'waiting',
        const [DisplayAction('scan', 'Check for truck')],
      );
    }
    if (s.decision != 'valid') {
      return card(
        s.licence,
        '${s.reason}\nInspection unavailable.',
        s.decision,
        const [DisplayAction('refresh', 'Refresh status')],
      );
    }
    final i = s.inspection;
    final expected = i['expectedSeal'] ?? 'Not supplied';
    final observed = i['observedSeal'] ?? 'Not read';
    final matches = i['sealMatches'] == true;
    final registration = i['flow'] == 'register';
    final assessment = i['assessment'] as Map?;
    final readable = assessment?['status'] == 'readable';
    switch (s.step) {
      case 'ready':
        return card(
          s.licence,
          '${s.direction} / ${s.field('destination')}\nTrailer ${s.field('trailer')} / ${s.field('driver')}',
          'waiting',
          const [DisplayAction('start', 'Start inspection')],
        );
      case 'trailer':
        return card(
          '1 / 4  Check trailer',
          '${s.field('trailer')}\nConfirm the trailer on this assignment.',
          'inspection',
          const [DisplayAction('trailer', 'Trailer confirmed')],
        );
      case 'seal':
        return card(
          '2 / 4  Photograph seal',
          '${registration ? 'Register seal / no reference' : 'Expected: $expected'}\nAim at the label. G: seal view.',
          'inspection',
          const [DisplayAction('capture', 'Capture and read seal')],
        );
      case 'photo_pending':
        return card(
          'Capturing evidence',
          'Keep the 3D browser tab focused.\nPhotographing your current view.',
          'photo',
          const [DisplayAction('capture', 'Retry capture')],
        );
      case 'analyzing':
        return card(
          'Reading photograph',
          'Local label detection + OCR\nReading pixels, not the assignment.',
          'photo',
          const [DisplayAction('capture', 'Retake')],
        );
      case 'photo_review':
        return card(
          readable ? 'Read: $observed' : 'Photo needs attention',
          _photoError ??
              (readable
                  ? 'OCR ${(assessment!['confidence'] as num).round()}% / verify the number'
                  : assessment?['status'] == 'no_seal'
                  ? 'No seal label in frame. Retake closer.'
                  : 'Number uncertain. Retake or report.'),
          readable ? 'photo' : 'incident',
          [
            if (_image != null && readable)
              const DisplayAction('accept-photo', 'Accept read number'),
            if (_image == null) const DisplayAction('refresh', 'Reload photo'),
            const DisplayAction('capture', 'Retake'),
            if (_image != null && !readable)
              const DisplayAction('report', 'Report for review'),
          ],
          image: _image,
        );
      case 'review':
        return card(
          '4 / 4  Review',
          'Photo read: $observed\n${registration ? 'Registration / no reference supplied' : 'Expected: $expected'}\n${registration || matches ? 'Save inspection. Gate stays closed.' : 'Mismatch: create incident and hold.'}',
          registration || matches ? 'review' : 'incident',
          [
            DisplayAction(
              'submit',
              registration || matches ? 'Save inspection' : 'Create incident',
            ),
          ],
        );
      case 'issue_review':
        return card(
          'Manual review required',
          'Unreadable or absent label in photo.\nPhoto will be attached to an incident.\nSupervisor must check the physical seal.',
          'incident',
          const [DisplayAction('submit', 'Create review incident')],
        );
      case 'complete':
        return card(
          'Inspection saved',
          '${s.licence} / ${registration ? 'seal registered' : 'seal matched'}\nRead from photo: $observed\nSaved locally / not a release authorization.',
          'complete',
          const [DisplayAction('refresh', 'Refresh status')],
        );
      case 'incident':
        final incident = i['incident'] as Map;
        return card(
          'HOLD / ${incident['title'] ?? 'Seal mismatch'}',
          'Expected $expected / read $observed\nPhoto attached / awaiting supervisor\nLocal incident ${incident['id'].toString().substring(0, 12)}',
          'incident',
          const [DisplayAction('refresh', 'Refresh status')],
        );
      default:
        return card(
          'Unknown inspection step',
          'Refresh the local service.',
          'offline',
          const [DisplayAction('refresh', 'Refresh status')],
        );
    }
  }

  Future<void> _render(int generation) async {
    if (!_current(generation)) return;
    final photoId = _snapshot?.inspection['photo']?['id'] as String?;
    if (_online &&
        _snapshot?.step == 'photo_review' &&
        photoId != null &&
        _photoId != photoId) {
      try {
        final image = await _api.photo(photoId);
        if (!_current(generation)) return;
        _image = image;
        _photoId = photoId;
        _photoError = null;
      } catch (_) {
        _photoError = 'Photo unavailable. Reload or retake.';
      }
    }
    final candidate = _card();
    final signature = jsonEncode([
      _snapshot?.identity,
      _snapshot?.inspectionVersion,
      _photoId,
      _image != null,
      candidate.title,
      candidate.subtitle,
      candidate.status,
      candidate.actions.map((a) => [a.id, a.label]).toList(),
    ]);
    if (_signature == signature) return;
    _revision++;
    _actions = {};
    final card = _card();
    try {
      await _bridge.render(card);
    } catch (_) {
      // DAT can time out rendering an image while the emulator is under load.
      // Retry the same display revision once; never repeat a business command.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      if (!_current(generation)) return;
      await _bridge.render(card);
    }
    if (!_current(generation)) return;
    _signature = signature;
    _actions = card.actions.map((a) => a.id).toSet();
  }

  @override
  Future<void> start() async {
    if (busy || state == PreviewState.active || _disposed) return;
    final generation = ++_generation;
    state = PreviewState.starting;
    error = null;
    _begin();
    _signature = '';
    _notify();
    try {
      await _bridge.start();
      if (!_current(generation)) return;
      try {
        final data = await _api.state();
        if (_current(generation)) _accept(data);
      } catch (e) {
        _online = false;
        error = '$e';
      }
      await _render(generation);
      if (!_current(generation)) return;
      state = PreviewState.active;
      _timer = Timer.periodic(pollInterval, (_) => refresh());
    } catch (e) {
      if (_current(generation)) {
        state = PreviewState.failed;
        error = '$e';
        try {
          await _bridge.stop();
        } catch (_) {}
      }
    } finally {
      _finish();
      _notify();
    }
  }

  Future<void> refresh() async {
    if (_operation || _disposed || state != PreviewState.active) return;
    _begin();
    final generation = _generation;
    try {
      try {
        final data = await _api.state();
        if (_current(generation)) _accept(data);
      } catch (e) {
        if (_current(generation)) {
          _online = false;

          error = '$e';
        }
      }
      await _render(generation);
    } catch (e) {
      if (_current(generation)) {
        state = PreviewState.failed;
        error = '$e';
        _timer?.cancel();
        _actions = {};
        try {
          await _bridge.stop();
        } catch (_) {}
      }
    } finally {
      _finish();
      _notify();
    }
  }

  Future<void> _select(DisplaySelection selection) async {
    // Polling must not swallow a user's SDK click. Wait, then revalidate the
    // displayed revision; duplicate clicks still become stale after rendering.
    if (!_disposed && _operation && state == PreviewState.active) {
      await _operationDone?.future;
      return _select(selection);
    }
    if (_disposed ||
        _operation ||
        state != PreviewState.active ||
        selection.revision != _revision ||
        !_actions.contains(selection.actionId)) {
      return;
    }
    _begin();
    final generation = _generation;
    final s = _snapshot;
    final action = selection.actionId;
    selectionCount++;
    lastAction = action;
    _actions = {};
    try {
      if (action == 'retry' || action == 'refresh') {
        final data = await _api.state();
        if (_current(generation)) _accept(data);
      } else if (_online && s != null && action == 'scan') {
        final data = await _api.command('scan', {'revision': s.revision});
        if (_current(generation)) _accept(data);
      } else if (_online && s != null) {
        final data = await _api.command('inspection/$action', {
          'revision': s.revision,
          'inspectionVersion': s.inspectionVersion,
          if (action == 'trailer') 'confirmed': true,
        });
        if (_current(generation)) _accept(data);
      }
    } catch (e) {
      if (_current(generation)) {
        _online = false;
        error = '$e';
      }
    } finally {
      // Always issue a fresh card revision after a selection, even if content is unchanged.
      if (_current(generation)) {
        _signature = '';
        try {
          await _render(generation);
        } catch (e) {
          state = PreviewState.failed;
          error = '$e';
          _timer?.cancel();
          _actions = {};
          try {
            await _bridge.stop();
          } catch (_) {}
        }
      }
      _finish();
      _notify();
    }
  }

  @override
  Future<void> stop() async {
    if (busy || _disposed) return;
    ++_generation;
    _timer?.cancel();
    _actions = {};

    state = PreviewState.stopping;
    _notify();
    try {
      await _operationDone?.future;
      await _bridge.stop();
      if (!_disposed) state = PreviewState.stopped;
    } catch (e) {
      if (!_disposed) {
        state = PreviewState.failed;
        error = '$e';
      }
    }
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    _timer?.cancel();
    _api.close();
    unawaited(_subscription.cancel());
    unawaited(
      _bridge.stop().catchError((Object _) {}).whenComplete(_bridge.dispose),
    );
    super.dispose();
  }
}
