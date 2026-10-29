import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../display/display_controller.dart';
import 'gatelens_theme.dart';

class PreviewScreen extends StatelessWidget {
  const PreviewScreen({super.key, required this.controller});
  final DisplaySession controller;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) => Scaffold(
      appBar: AppBar(
        leading: const Icon(Icons.shield_outlined, color: GateLensColors.primary),
        title: const Text('GateLens'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: GateLensColors.surface,
                borderRadius: BorderRadius.circular(15),
                border: Border.all(
                  color: GateLensColors.primary.withValues(alpha: .4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'TRUCK INSPECTION',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: GateLensColors.primary,
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Depot / Exit inspection',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Trailer · Seal · Photo · Incident',
                    style: TextStyle(color: GateLensColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'DEMO · Local photo OCR / synthetic assignments',
              style: TextStyle(color: GateLensColors.muted, fontSize: 12),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  key: const Key('start-preview'),
                  onPressed:
                      controller.busy || controller.state == PreviewState.active
                      ? null
                      : controller.start,
                  icon: const Icon(Icons.visibility_outlined),
                  label: const Text('Start Meta preview'),
                ),
                OutlinedButton(
                  key: const Key('stop-preview'),
                  onPressed: controller.state == PreviewState.active
                      ? controller.stop
                      : null,
                  child: const Text('Stop'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Session: ${controller.state.name}',
              key: const Key('session-status'),
            ),
            if (controller.error case final error?)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: SelectableText(
                  error,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            const SizedBox(height: 16),
            AspectRatio(
              aspectRatio: 1,
              child: ColoredBox(
                color: Colors.black,
                child:
                    controller.state == PreviewState.active &&
                        !kIsWeb &&
                        defaultTargetPlatform == TargetPlatform.android
                    ? const AndroidView(viewType: 'dev.gatelens/meta-preview')
                    : const Center(
                        child: Text('Start the official SDK preview'),
                      ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Actions received in Dart: ${controller.selectionCount}',
              key: const Key('selection-count'),
            ),
            Text(
              'Last action: ${controller.lastAction}',
              key: const Key('last-action'),
            ),
            const SizedBox(height: 20),
            const ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text('Developer connection details'),
              children: [
                SelectableText(
                  'Linked checkpoint: adb reverse tcp:9010 tcp:9010 and '
                  'adb forward tcp:9000 tcp:9000. Open http://127.0.0.1:9010/glasses '
                  'in Chrome and enable Meta Display Simulator. '
                  'Standalone SDK preview: http://127.0.0.1:9000. No tabs open automatically.',
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}
