package dev.gatelens.gatelens_companion

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.util.Base64
import android.view.View
import android.widget.FrameLayout
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.SpecificDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.display.Display
import com.meta.wearable.dat.display.addDisplay
import com.meta.wearable.dat.display.removeDisplay
import com.meta.wearable.dat.display.types.DisplayState
import com.meta.wearable.dat.display.views.ActionRole
import com.meta.wearable.dat.display.views.Direction
import com.meta.wearable.dat.display.views.TextStyle
import com.meta.wearable.dat.display.views.TextColor
import com.meta.wearable.dat.display.views.ImageSize
import com.meta.wearable.dat.display.views.ButtonStyle
import com.meta.wearable.dat.display.views.IconName
import com.meta.wearable.dat.mockdevice.MockDeviceKit
import com.meta.wearable.dat.mockdevice.api.GlassesModel
import com.meta.wearable.dat.mockdevice.api.MockGlasses
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

/** Mock-only adapter. Dart owns card content and transitions; Meta owns rendering. */
class MetaDisplayBridge(private val activity: MainActivity, engine: FlutterEngine) {
    private val channel = MethodChannel(engine.dartExecutor.binaryMessenger, "dev.gatelens/display")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private val kit by lazy { MockDeviceKit.getInstance(activity.applicationContext) }
    private var glasses: MockGlasses? = null
    private var session: DeviceSession? = null
    private var display: Display? = null
    private var initialized = false
    private var mockEnabled = false
    private var closed = false
    private var currentRevision = -1
    private var previewView: View? = null

    init {
        channel.setMethodCallHandler(::handle)
        engine.platformViewsController.registry.registerViewFactory(
            "dev.gatelens/meta-preview", object : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
                override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
                    val container = FrameLayout(context)
                    val preview = glasses?.services?.display?.createPreviewView(context)
                    previewView = preview
                    if (preview != null) container.addView(preview)
                    return object : PlatformView {
                        override fun getView(): View = container
                        override fun dispose() { if (previewView === preview) previewView = null; container.removeAllViews() }
                    }
                }
            },
        )
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        if (closed) { result.error("CLOSED", "Display bridge has closed", null); return }
        if (call.method == "debugSelectPrimary") {
            if (activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) {
                result.error("DEBUG_ONLY", "Test input is unavailable", null)
                return
            }
            fun findWebView(view: View?): android.webkit.WebView? {
                if (view is android.webkit.WebView) return view
                if (view is android.view.ViewGroup) {
                    for (index in 0 until view.childCount) {
                        findWebView(view.getChildAt(index))?.let { return it }
                    }
                }
                return null
            }
            val webView = findWebView(previewView)
            if (webView == null) { result.success(false); return }
            // Exercise the SDK's own preview DOM and its real click -> DAT callback path.
            webView.evaluateJavascript(
                "(() => { const b = document.querySelector('button,[role=button]'); if (!b) return false; b.click(); return true; })()"
            ) { value -> result.success(value == "true") }
            return
        }
        scope.launch {
            try {
                mutex.withLock {
                    when (call.method) {
                        "start" -> start()
                        "render" -> render(call)
                        "stop" -> stop()
                        else -> { result.notImplemented(); return@withLock }
                    }
                    result.success(null)
                }
            } catch (e: CancellationException) {
                result.error("CANCELLED", "Display operation cancelled", null)
                throw e
            } catch (e: Exception) {
                if (call.method == "start") runCatching { stop() }
                result.error("META_DISPLAY", e.message ?: e.javaClass.simpleName, null)
            }
        }
    }

    private suspend fun start() {
        check(display == null) { "Preview is already running" }
        if (!initialized) {
            Wearables.initialize(activity)
            initialized = true
        }
        // The mock environment belongs to the activity, not to an individual session.
        // Cycling kit.disable()/enable() here races the SDK's background teardown.
        if (!mockEnabled) {
            kit.enable()
            mockEnabled = true
        }
        val mock = glasses ?: kit.pairGlasses(GlassesModel.META_RAYBAN_DISPLAY).getOrNull()
            ?.also { glasses = it }
            ?: error("Meta could not pair the mock Display device")
        mock.powerOn()
        mock.don()
        withTimeout(20_000) {
            Wearables.devices.first { mock.deviceIdentifier in it }
            val newSession = Wearables.createSession(SpecificDeviceSelector(mock.deviceIdentifier)).onFailure { error, _ -> kotlin.error("Meta session: ${error.description}") }.getOrNull()
                ?: error("Meta could not create a mock session")
            session = newSession
            newSession.start()
            newSession.state.first { it == DeviceSessionState.STARTED }
            val newDisplay = newSession.addDisplay().getOrNull()
                ?: error("Meta could not attach Display")
            display = newDisplay
            newDisplay.state.first { it == DisplayState.STARTED }
            kit.startTestServer(9000).getOrNull()
                ?: error("Meta Chrome preview server could not start on port 9000")
        }
    }

    private suspend fun render(call: MethodCall) {
        val target = display ?: error("Start a preview before rendering")
        val revision = call.argument<Int>("revision") ?: error("Missing revision")
        val title = call.argument<String>("title") ?: error("Missing title")
        val subtitle = call.argument<String>("subtitle") ?: error("Missing subtitle")
        val status = call.argument<String>("status") ?: "demo"
        val actions = call.argument<List<Map<String, Any>>>("actions") ?: error("Missing actions")
        require(actions.size in 1..3) { "A card needs one to three actions" }
        val evidence = call.argument<String>("imageBase64")?.let { encoded ->
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            decoded?.let { Bitmap.createScaledBitmap(it, 480, 270, true) }
        }
        currentRevision = revision
        target.sendContent {
            flexBox(direction = Direction.COLUMN, padding = 24, gap = 8) {
                if (evidence == null) image(bitmap = GateLensDisplayHeader.bitmap(status), sizePreset = ImageSize.FILL)
                text(title, style = TextStyle.HEADING)
                if (evidence != null) image(bitmap = evidence, sizePreset = ImageSize.FILL)
                subtitle.lines().filter { it.isNotBlank() }.forEachIndexed { index, line ->
                    text(line, style = if (index == 0) TextStyle.BODY else TextStyle.META,
                        color = if (index == 0) TextColor.PRIMARY else TextColor.SECONDARY)
                }
                buttonGroup {
                    actions.forEachIndexed { index, action ->
                        val actionId = action["id"] as String
                        button(
                            action["label"] as String,
                            style = if (actionId in listOf("start", "trailer", "seal", "capture", "accept-photo", "submit")) ButtonStyle.PRIMARY else ButtonStyle.SECONDARY,
                            iconName = when (actionId) {
                                "open" -> IconName.PADLOCK_OPEN
                                "confirm" -> IconName.CHECKMARK
                                "cancel" -> IconName.X
                                "details" -> IconName.I_CIRCLE
                                "back" -> IconName.ARROW_LEFT
                                else -> null
                            },
                            actionRole = if (index == 0) ActionRole.PRIMARY else null,
                            onClick = {
                                scope.launch {
                                    if (!closed && display != null && currentRevision == revision) {
                                        channel.invokeMethod("selection", mapOf("actionId" to actionId, "revision" to revision))
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }.onFailure { error, _ -> error("Meta rejected content: ${error.description}") }
    }

    private suspend fun stop() {
        currentRevision = -1
        kit.stopTestServer()
        val oldSession = session
        session = null
        display = null
        if (oldSession != null) {
            oldSession.removeDisplay()
            oldSession.stop()
            withTimeout(8_000) { oldSession.state.first { it == DeviceSessionState.STOPPED } }
        }
        // STOPPED is terminal: the next start must create a NEW DeviceSession.
        // Keep the paired mock device idle until the activity is destroyed.
    }

    fun close() {
        closed = true
        channel.setMethodCallHandler(null)
        scope.launch {
            try {
                mutex.withLock {
                    if (initialized) runCatching { stop() }
                    glasses?.doff()
                    glasses?.powerOff()
                    glasses = null
                    if (mockEnabled) kit.disable()
                    mockEnabled = false
                }
            } finally { scope.cancel() }
        }
    }
}
