import 'dart:async';
import 'package:flutter/services.dart';
import 'display_card.dart';

class DisplaySelection {
  const DisplaySelection(this.actionId, this.revision);
  final String actionId;
  final int revision;
}

abstract interface class DisplayBridge {
  Stream<DisplaySelection> get selections;
  Future<void> start();
  Future<void> render(DisplayCard card);
  Future<void> stop();
  Future<void> dispose();
}

/// start/stop/render calls go to Android; selection callbacks come back to Dart.
class MethodChannelDisplayBridge implements DisplayBridge {
  MethodChannelDisplayBridge({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('dev.gatelens/display') {
    _channel.setMethodCallHandler(_onNativeCall);
  }
  final MethodChannel _channel;
  final _selections = StreamController<DisplaySelection>.broadcast();
  @override
  Stream<DisplaySelection> get selections => _selections.stream;
  Future<void> _onNativeCall(MethodCall call) async {
    if (call.method != 'selection' || _selections.isClosed) return;
    final args = Map<Object?, Object?>.from(call.arguments as Map);
    _selections.add(
      DisplaySelection(args['actionId'] as String, args['revision'] as int),
    );
  }

  @override
  Future<void> start() => _channel.invokeMethod<void>('start');
  @override
  Future<void> render(DisplayCard card) =>
      _channel.invokeMethod<void>('render', card.toMap());
  @override
  Future<void> stop() => _channel.invokeMethod<void>('stop');
  @override
  Future<void> dispose() async {
    _channel.setMethodCallHandler(null);
    await _selections.close();
  }
}
