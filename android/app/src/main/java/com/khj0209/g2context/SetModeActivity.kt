package com.khj0209.g2context

import android.app.Activity
import android.os.Bundle
import android.widget.Toast

/**
 * Entry point for Samsung Modes & Routines ("앱 열기 또는 앱 작업" → a G2 Context shortcut) and other
 * automation: g2context://mode/<id> fixes that mode, g2context://mode/auto returns to detection.
 * g2context://drive/home or /work (commute routines) fixes 운전 and starts the Drive HUD's guidance
 * there; disconnecting the car's Bluetooth ends it.
 */
class SetModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val seg = intent.data?.lastPathSegment
        val dest = seg?.takeIf { intent.data?.host == "drive" && it in DESTINATIONS }
        val mode = if (dest != null) Mode.DRIVING else Mode.of(seg)
        prefs(this).edit().apply {
            if (mode != null) putString(KEY_OVERRIDE, mode.id) else remove(KEY_OVERRIDE)
            if (dest != null) putString(KEY_DEST, dest).putLong(KEY_DEST_AT, System.currentTimeMillis())
            else remove(KEY_DEST).remove(KEY_DEST_AT)
        }.apply()
        startContextService(this)
        val label = dest?.let { "${DESTINATIONS[it]} 안내" } ?: "${mode?.label ?: "자동"} 모드"
        Toast.makeText(this, "G2: $label", Toast.LENGTH_SHORT).show()
        finish()
    }

    private companion object {
        val DESTINATIONS = mapOf("home" to "집으로", "work" to "회사로")
    }
}
