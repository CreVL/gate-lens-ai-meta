package dev.gatelens.gatelens_companion

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var displayBridge: MetaDisplayBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        displayBridge = MetaDisplayBridge(this, flutterEngine)
    }

    override fun onDestroy() {
        displayBridge?.close()
        displayBridge = null
        super.onDestroy()
    }
}
