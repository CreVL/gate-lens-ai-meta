import 'package:flutter/foundation.dart';

enum PreviewState { stopped, starting, active, stopping, failed }

abstract class DisplaySession extends ChangeNotifier {
  PreviewState get state;
  String? get error;
  String get lastAction;
  int get selectionCount;
  bool get busy;
  Future<void> start();
  Future<void> stop();
}
