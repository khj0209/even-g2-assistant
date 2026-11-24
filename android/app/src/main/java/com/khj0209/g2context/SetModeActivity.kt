package com.khj0209.g2context

import android.app.Activity
import android.os.Bundle
import android.widget.Toast

/**
 * Entry point for Samsung Modes & Routines ("앱 열기 또는 앱 작업" → a G2 Context shortcut) and other
 * automation: g2context://mode/<id> fixes that mode, g2context://mode/auto returns to detection.
 */
class SetModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mode = Mode.of(intent.data?.lastPathSegment)
        prefs(this).edit().apply { if (mode != null) putString(KEY_OVERRIDE, mode.id) else remove(KEY_OVERRIDE) }.apply()
        startContextService(this)
        Toast.makeText(this, "G2: ${mode?.label ?: "자동"} 모드", Toast.LENGTH_SHORT).show()
        finish()
    }
}
