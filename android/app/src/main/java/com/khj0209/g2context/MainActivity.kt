package com.khj0209.g2context

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Shows the current mode, asks for the permissions detection needs, and lets you fix a mode by hand. */
class MainActivity : Activity(), SharedPreferences.OnSharedPreferenceChangeListener {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 64)
        }
        status = TextView(this).apply { textSize = 20f }
        root.addView(status)
        root.addView(button("권한 허용 (움직임 · 캘린더 · 알림)") { requestPermissions(PERMISSIONS, 1) })
        root.addView(button("배터리 최적화 제외 (삼성 기기 필수)") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        })
        root.addView(text("\n모드 직접 지정"))
        root.addView(button("자동 감지로 되돌리기") { setOverride(null) })
        Mode.entries.forEach { m -> root.addView(button("${m.label} 모드") { setOverride(m) }) }
        root.addView(text(HELP))
        setContentView(ScrollView(this).apply { addView(root) })
        startContextService(this)
    }

    override fun onResume() {
        super.onResume()
        prefs(this).registerOnSharedPreferenceChangeListener(this)
        update()
    }

    override fun onPause() {
        prefs(this).unregisterOnSharedPreferenceChangeListener(this)
        super.onPause()
    }

    override fun onSharedPreferenceChanged(p: SharedPreferences?, key: String?) = update()

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        registerActivityUpdates(this)
        startContextService(this)
        update()
    }

    private fun setOverride(mode: Mode?) {
        prefs(this).edit().apply { if (mode != null) putString(KEY_OVERRIDE, mode.id) else remove(KEY_OVERRIDE) }.apply()
    }

    private fun update() {
        val p = prefs(this)
        val mode = Mode.of(p.getString(KEY_CURRENT, null)) ?: Mode.ASSISTANT
        val missing = PERMISSIONS.filterNot { granted(this, it) }.map { PERMISSION_LABELS[it] }
        status.text = buildString {
            append("지금: ${mode.label} 모드\n")
            append("이유: ${SOURCE_LABELS[p.getString(KEY_SOURCE, "default")]}\n")
            append("직접 지정: ${Mode.of(p.getString(KEY_OVERRIDE, null))?.label ?: "없음 (자동)"}\n")
            append(if (missing.isEmpty()) "권한: 모두 허용됨" else "허용 필요: ${missing.joinToString()}")
        }
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun text(s: String) = TextView(this).apply { text = s }

    companion object {
        private val PERMISSIONS = arrayOf(
            Manifest.permission.ACTIVITY_RECOGNITION,
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.POST_NOTIFICATIONS,
        )
        private val PERMISSION_LABELS = mapOf(
            Manifest.permission.ACTIVITY_RECOGNITION to "신체 활동",
            Manifest.permission.READ_CALENDAR to "캘린더",
            Manifest.permission.POST_NOTIFICATIONS to "알림",
        )
        private const val HELP = """
자동 감지
· 운전: 차량 이동이 감지되면 (다른 모드보다 우선)
· 러닝: 달리기가 감지되면
· 운동: 자전거가 감지되면
· 회의: 캘린더에 지금 '바쁨' 일정이 있으면

삼성 모드 및 루틴 연동 (장소·와이파이·시간 기반)
루틴 만들기 → 조건(예: 회사 도착, 헬스장 와이파이 연결) → 실행할 동작 → 앱 → '앱 열기 또는 앱 작업' → G2 Context → 'G2 개발 모드' 같은 바로가기를 고르세요.
루틴이 끝날 때 쓸 반대 루틴(예: 회사에서 나가면)에는 'G2 자동 모드'를 넣으면 자동 감지로 돌아갑니다.

안경의 G2 Assistant가 이 앱에서 지금 모드를 읽어 몽이의 답변 방식을 바꿉니다.
"""
    }
}
