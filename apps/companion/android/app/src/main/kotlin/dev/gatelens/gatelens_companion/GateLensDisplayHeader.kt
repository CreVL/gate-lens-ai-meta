package dev.gatelens.gatelens_companion

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/** Small, cached brand/status image sent through the public SDK image API.
 * Text and interactive controls remain SDK-native; no renderer CSS overrides.
 * A text label accompanies every status color. No private GateLens assets are used.
 */
object GateLensDisplayHeader {
    private val cache = mutableMapOf<String, Bitmap>()
    private val labels = mapOf(
        "inspection" to "INSPECT", "photo" to "PHOTO", "incident" to "HOLD", "complete" to "SAVED", "review" to "REVIEW",
        "demo" to "DEMO", "waiting" to "READY", "valid" to "VALID",
        "expired" to "EXPIRED", "blocked" to "BLOCKED",
        "confirm" to "CONFIRM", "offline" to "OFFLINE", "passed" to "PASSED",
    )

    fun bitmap(status: String): Bitmap {
        val key = if (status in labels) status else "demo"
        return cache.getOrPut(key) {
            val bitmap = Bitmap.createBitmap(552, 56, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            paint.color = Color.rgb(102, 195, 193) // GateLens primary #66C3C1
            canvas.drawRoundRect(0f, 5f, 5f, 51f, 2f, 2f, paint)
            paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            paint.textSize = 26f
            canvas.drawText("GateLens", 18f, 36f, paint)
            paint.color = Color.rgb(180, 230, 228) // GateLens mint #B4E6E4
            paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
            paint.textSize = 21f
            paint.color = when (key) {
                "blocked", "offline", "incident" -> Color.rgb(229, 115, 115)
                "expired", "confirm" -> Color.rgb(255, 196, 107)
                "valid", "passed", "complete" -> Color.rgb(168, 218, 181)
                else -> Color.rgb(180, 230, 228)
            }
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f
            canvas.drawRoundRect(384f, 6f, 550f, 50f, 22f, 22f, paint)
            paint.style = Paint.Style.FILL
            paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            paint.textSize = 19f
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(labels.getValue(key), 467f, 35f, paint)
            bitmap
        }
    }
}
