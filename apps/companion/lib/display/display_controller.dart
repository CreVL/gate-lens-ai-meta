import 'dart:async';
import 'display_session.dart';
export 'display_session.dart';
import 'display_bridge.dart';
import 'display_card.dart';

class DisplayController extends DisplaySession {
  DisplayController(this._bridge) {
    _subscription = _bridge.selections.listen(_onSelection);
  }
  final DisplayBridge _bridge;
  late final StreamSubscription<DisplaySelection> _subscription;
  @override
  PreviewState state = PreviewState.stopped;
  @override
  String? error;
  @override
  String lastAction = 'No display action received';
  @override
  int selectionCount = 0;
  int _revision = 0;
  bool _disposed = false;
  bool _handlingSelection = false;
  Set<String> _shownActions = {};
  int _epoch = 0;
  @override
  bool get busy =>
      state == PreviewState.starting || state == PreviewState.stopping;
  DisplayCard get card => DisplayCard(
    revision: _revision,
    title: 'DEMO-001',
    subtitle: 'Synthetic vehicle\nValid test entry\nNo barrier connected',
    actions: const [
      DisplayAction('details', 'View entry'),
      DisplayAction('dismiss', 'Finish check'),
    ],
  );

  @override
  Future<void> start() async {
    if (busy || state == PreviewState.active || _disposed) return;
    state = PreviewState.starting;
    final epoch = ++_epoch;
    error = null;
    _notify();
    try {
      await _bridge.start();
      if (_disposed) return;
      _revision++;
      _shownActions = card.actions.map((action) => action.id).toSet();
      await _bridge.render(card);
      if (_disposed || epoch != _epoch) return;
      state = PreviewState.active;
    } catch (e) {
      if (_disposed || epoch != _epoch) return;
      await _cleanup();
      state = PreviewState.failed;
      error = '$e';
    }
    _notify();
  }

  Future<void> _onSelection(DisplaySelection selection) async {
    if (_disposed ||
        state != PreviewState.active ||
        selection.revision != _revision ||
        _handlingSelection) {
      return;
    }
    if (!_shownActions.contains(selection.actionId)) return;
    final epoch = _epoch;
    _handlingSelection = true;
    selectionCount++;
    lastAction = selection.actionId;
    _revision++;
    _notify();
    try {
      final next = selection.actionId == 'return'
          ? card
          : DisplayCard(
              revision: _revision,
              title: selection.actionId == 'details'
                  ? 'Test entry'
                  : 'Check finished',
              subtitle: selection.actionId == 'details'
                  ? 'Vehicle: DEMO-001\nCheckpoint: Demo North\nFictional data only'
                  : 'No opening requested\nNo hardware connected',
              actions: const [DisplayAction('return', 'Show vehicle')],
            );
      _shownActions = next.actions.map((action) => action.id).toSet();
      await _bridge.render(next);
    } catch (e) {
      if (_disposed || epoch != _epoch) return;
      await _cleanup();
      state = PreviewState.failed;
      error = '$e';
    } finally {
      _handlingSelection = false;
      _notify();
    }
  }

  @override
  Future<void> stop() async {
    if (busy || _disposed) return;
    state = PreviewState.stopping;
    _epoch++;
    _shownActions = {};
    _revision++;
    _notify();
    try {
      await _bridge.stop();
      state = PreviewState.stopped;
    } catch (e) {
      state = PreviewState.failed;
      error = '$e';
    }
    _notify();
  }

  Future<void> _cleanup() async {
    try {
      await _bridge.stop();
    } catch (_) {
      /* Keep the original error. */
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    unawaited(_subscription.cancel());
    unawaited(_cleanup().whenComplete(_bridge.dispose));
    super.dispose();
  }
}
