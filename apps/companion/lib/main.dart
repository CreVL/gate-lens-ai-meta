import 'package:flutter/material.dart';
import 'display/display_bridge.dart';
import 'display/display_controller.dart';
import 'ui/preview_screen.dart';
import 'checkpoint/checkpoint_api.dart';
import 'checkpoint/checkpoint_controller.dart';
import 'ui/gatelens_theme.dart';

void main() => runApp(const GateLensApp());

class GateLensApp extends StatefulWidget {
  const GateLensApp({super.key, this.bridge, this.linked = true});
  final DisplayBridge? bridge;
  final bool linked;
  @override
  State<GateLensApp> createState() => _GateLensAppState();
}

class _GateLensAppState extends State<GateLensApp> with WidgetsBindingObserver {
  late final DisplaySession controller = widget.linked
      ? CheckpointController(
          widget.bridge ?? MethodChannelDisplayBridge(),
          LocalCheckpointApi(),
        )
      : DisplayController(widget.bridge ?? MethodChannelDisplayBridge());
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (const bool.fromEnvironment('GATELENS_AUTOSTART')) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) controller.start();
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.detached) &&
        controller.state == PreviewState.active) {
      controller.stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'GateLens',
    debugShowCheckedModeBanner: false,
    theme: gateLensTheme,
    home: PreviewScreen(controller: controller),
  );
}
