package com.khj0209.g2context

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Top to bottom: the current mode, setup steps that are still missing, the pairing code for the
 * glasses app, a grid to fix a mode by hand, then help and diagnostics.
 */
class MainActivity : Activity(), SharedPreferences.OnSharedPreferenceChangeListener {
    private lateinit var modeView: TextView
    private lateinit var reasonView: TextView
    private lateinit var setupTitle: TextView
    private lateinit var permissionButton: Button
    private lateinit var batteryButton: Button
    private lateinit var mediaButton: Button
    private lateinit var diagnostics: TextView
    private val modeButtons = mutableMapOf<Mode?, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        root.addView(text("G2 Context", 14f, dim = true))
        modeView = text("", 40f).apply { setTypeface(typeface, Typeface.BOLD) }
        root.addView(modeView)
        reasonView = text("", 15f, dim = true)
        root.addView(reasonView)

        setupTitle = heading("설정이 필요해요")
        root.addView(setupTitle)
        permissionButton = button("움직임 · 캘린더 · 알림 권한 허용") { requestPermissions(PERMISSIONS, 1) }
        batteryButton = button("배터리 최적화 제외 (삼성 기기 필수)") {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
        mediaButton = button("재생 정보 접근 허용 (알림 접근)") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        listOf(permissionButton, batteryButton, mediaButton).forEach(root::addView)

        root.addView(heading("안경 앱 연결 코드"))
        root.addView(text(pairingCode(this), 30f).apply {
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.15f
            setTextIsSelectable(true)
        })
        root.addView(text("Even 앱 → G2 Assistant → 설정 → G2 Context 연결에 입력하면 재생 중인 음악·영상이 안경에 보여요.", 13f, dim = true))

        root.addView(heading("모드 직접 지정"))
        val grid = GridLayout(this).apply { columnCount = 3 }
        (listOf<Mode?>(null) + Mode.entries).forEach { m ->
            val b = button(m?.label ?: "자동") { setOverride(m) }
            b.layoutParams = GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                width = 0
                setMargins(dp(3), dp(3), dp(3), dp(3))
            }
            modeButtons[m] = b
            grid.addView(b)
        }
        root.addView(grid)

        root.addView(heading("도움말"))
        root.addView(text(HELP.trim(), 14f, dim = true))
        diagnostics = text("", 12f, dim = true).apply { setPadding(0, dp(16), 0, 0) }
        root.addView(diagnostics)

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
        val override = Mode.of(p.getString(KEY_OVERRIDE, null))
        modeView.text = "${mode.label} 모드"
        reasonView.text = SOURCE_LABELS[p.getString(KEY_SOURCE, "default")] ?: ""

        // Setup steps disappear once done.
        val needPermissions = PERMISSIONS.any { !granted(this, it) }
        val needBattery = !getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        val needMedia = !mediaAccessGranted(this)
        permissionButton.visibility = if (needPermissions) View.VISIBLE else View.GONE
        batteryButton.visibility = if (needBattery) View.VISIBLE else View.GONE
        mediaButton.visibility = if (needMedia) View.VISIBLE else View.GONE
        setupTitle.visibility = if (needPermissions || needBattery || needMedia) View.VISIBLE else View.GONE

        modeButtons.forEach { (m, b) -> b.isSelected = m == override; b.alpha = if (m == override) 1f else 0.6f }

        val at = p.getLong(KEY_SERVED_AT, 0)
        diagnostics.text = buildString {
            append("로컬 서버: ${p.getString(KEY_SERVER, "아직 시작 안 됨")}\n")
            append("받은 요청: ${p.getInt(KEY_SERVED, 0)}회")
            if (at > 0) append(" (마지막 ${SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(at)})")
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun text(s: String, size: Float, dim: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        if (dim) alpha = 0.7f
    }

    private fun heading(s: String) = text(s, 16f).apply {
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(24), 0, dp(6))
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    companion object {
        private val PERMISSIONS = arrayOf(
            Manifest.permission.ACTIVITY_RECOGNITION,
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.POST_NOTIFICATIONS,
        )
        private const val HELP = """
자동 감지: 운전(차량 이동, 항상 우선) · 러닝(달리기) · 운동(자전거) · 회의(캘린더 '바쁨' 일정)

삼성 모드 및 루틴: 루틴의 동작에서 앱 → '앱 열기 또는 앱 작업' → G2 Context → 'G2 개발 모드' 같은 바로가기를 고르면 장소·와이파이·시간으로 모드가 바뀌어요. 반대 조건의 루틴에는 'G2 자동 모드'를 넣으세요.
"""
    }
}
