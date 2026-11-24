package com.khj0209.g2context

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.app.Dialog
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Top to bottom: the current mode, setup steps that are still missing, the Claude key, the pairing
 * code for the glasses app, a grid to fix a mode by hand, the car, then help and diagnostics.
 * Same look as the glasses app: near-black glass with the G2's phosphor green as the one accent.
 */
class MainActivity : Activity(), SharedPreferences.OnSharedPreferenceChangeListener {
    private lateinit var modeView: TextView
    private lateinit var reasonView: TextView
    private lateinit var setupCard: View
    private lateinit var permissionButton: Button
    private lateinit var batteryButton: Button
    private lateinit var mediaButton: Button
    private lateinit var diagnostics: TextView
    private lateinit var keyState: TextView
    private lateinit var carState: TextView
    private lateinit var healthState: TextView
    private lateinit var healthButton: Button
    private lateinit var stState: TextView
    /** The `state` of the SmartThings sign-in in progress, checked when it comes back. */
    private var stLoginState: String? = null
    private val modeButtons = mutableMapOf<Mode?, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.setBackgroundColor(BG)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        // Current mode, big and glowing like the glasses' readout.
        root.addView(label("G2 CONTEXT", ACCENT).apply { setPadding(dp(4), 0, 0, dp(10)) })
        modeView = text("", 44f, color = ACCENT).apply {
            setTypeface(typeface, Typeface.BOLD)
            setShadowLayer(dp(14).toFloat(), 0f, 0f, GLOW)
        }
        reasonView = text("", 14f, color = DIM)
        root.addView(card(null, label("지금"), modeView, reasonView, strong = true))

        permissionButton = button("마이크 · 움직임 · 캘린더 · 알림 · 블루투스 권한 허용", PRIMARY) { requestPermissions(PERMISSIONS, 1) }
        batteryButton = button("배터리 최적화 제외 (삼성 기기 필수)", PRIMARY) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
        mediaButton = button("재생 정보 접근 허용 (알림 접근)", PRIMARY) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        healthButton = button("삼성헬스 연결 (Health Connect 권한)", PRIMARY) { requestPermissions(HEALTH_PERMISSIONS, 2) }
        setupCard = card("설정이 필요해요", permissionButton, batteryButton, mediaButton, healthButton)
        root.addView(setupCard)

        keyState = text("", 15f)
        val keyInput = EditText(this).apply {
            hint = "sk-ant-…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(TEXT)
            setHintTextColor(DIM)
            background = rounded(INPUT, LINE, dp(12).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val saveKey = button("저장", PRIMARY) {
            val key = keyInput.text.toString().trim()
            if (!looksLikeClaudeKey(key)) {
                keyState.text = "Claude API 키는 sk-ant- 로 시작해요"
                return@button
            }
            saveClaudeKey(this, key)
            keyInput.text.clear()
            update()
        }
        val deleteKey = button("삭제", DANGER) {
            saveClaudeKey(this, null)
            update()
        }
        root.addView(
            card(
                "Claude API 키",
                keyState,
                keyInput.spaced(),
                row(saveKey, deleteKey),
                note("Android 키 저장소로 암호화해 이 휴대폰에만 보관하고, 연결 코드를 넣은 안경 앱에만 넘겨줘요."),
            ),
        )

        val code = text(pairingCode(this), 34f, color = ACCENT).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            letterSpacing = 0.2f
            gravity = Gravity.CENTER
            setTextIsSelectable(true)
            background = rounded(INPUT, LINE_STRONG, dp(14).toFloat())
            setPadding(0, dp(14), 0, dp(14))
        }
        root.addView(card("안경 앱 연결 코드", code.spaced(), note("Even 앱 → G2 Assistant → 설정 → G2 Context 연결에 입력하세요.")))

        val grid = GridLayout(this).apply { columnCount = 3 }
        (listOf<Mode?>(null) + Mode.entries).forEach { m ->
            val b = button(m?.label ?: "자동", NORMAL) { setOverride(m) }
            b.layoutParams = GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                width = 0
                setMargins(dp(4), dp(4), dp(4), dp(4))
            }
            modeButtons[m] = b
            grid.addView(b)
        }
        root.addView(card("모드 직접 지정", grid, note("'자동'이면 움직임·캘린더·루틴으로 정해져요.")))

        carState = text("", 15f)
        val carOnly = CheckBox(this).apply {
            text = "차량 블루투스에 연결됐을 때만 운전으로 판단 (버스·택시 승객일 때 운전 모드가 켜지지 않게)"
            setTextColor(TEXT)
            buttonTintList = ColorStateList.valueOf(ACCENT)
            isChecked = prefs(this@MainActivity).getBoolean(KEY_CAR_ONLY, false)
            setOnCheckedChangeListener { _, on -> prefs(this@MainActivity).edit().putBoolean(KEY_CAR_ONLY, on).apply() }
        }
        root.addView(card("차량 블루투스", carState, carOnly.spaced(), note("차 오디오·핸즈프리 블루투스에 연결되면 움직임과 상관없이 운전 모드가 됩니다.")))

        healthState = text("", 15f)
        root.addView(
            card(
                "삼성헬스",
                healthState,
                note("삼성헬스 → 설정 → Health Connect에서 걸음·수면·심박 공유를 켜 두세요. 워치의 연속 심박은 몇 분씩 늦게 들어올 수 있어요."),
            ),
        )

        stState = text("", 15f)
        val stClient = input("Client ID", prefs(this).getString(KEY_ST_CLIENT, "") ?: "")
        val stSecret = input("Client Secret", "", password = true)
        val stRedirectInput = input("Redirect URI", stRedirect(this))
        val stPaste = input("브라우저 로그인 후 주소창의 주소 붙여넣기", "")
        val saveAndLogin = button("저장하고 로그인", PRIMARY) {
            val id = stClient.text.toString().trim()
            val sec = stSecret.text.toString().trim()
            if (id.isEmpty() || (sec.isEmpty() && secretMissing())) {
                stState.text = "Client ID와 Client Secret을 넣어 주세요"
                return@button
            }
            stSaveClient(this, id, sec.ifEmpty { currentSecret() }, stRedirectInput.text.toString().trim().ifEmpty { ST_DEFAULT_REDIRECT })
            stSecret.text.clear()
            stLogin()
        }
        val inBrowser = button("브라우저로 로그인", NORMAL) {
            stLoginState = java.util.UUID.randomUUID().toString()
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(stAuthorizeUrl(this, stLoginState!!))))
        }
        val usePasted = button("붙여넣은 주소로 연결", NORMAL) { finishStLogin(stPaste.text.toString().trim()) }
        val disconnect = button("연결 해제", DANGER) {
            stDisconnect(this)
            update()
        }
        root.addView(
            card(
                "SmartThings",
                stState,
                stClient.spaced(),
                stSecret.spaced(),
                stRedirectInput.spaced(),
                saveAndLogin,
                row(inBrowser, disconnect),
                stPaste.spaced(),
                usePasted,
                note(
                    "한 번만: PC에서 SmartThings CLI로 `smartthings apps:create` → OAuth-In App을 만들고, Redirect URI에 위 주소를, " +
                        "권한에 기기·장면 읽기/실행을 넣어 받은 Client ID·Secret을 입력하세요. 로그인 화면이 앱 안에서 안 열리면 " +
                        "'브라우저로 로그인' 뒤 마지막 주소를 붙여넣으세요.",
                ),
            ),
        )

        diagnostics = text("", 12f, color = DIM).apply { setPadding(0, dp(12), 0, 0) }
        root.addView(card("도움말", note(HELP.trim()), diagnostics))

        val scroll = ScrollView(this).apply {
            addView(root)
            // Android 15 draws apps edge to edge: keep the content clear of the status and navigation bars.
            setOnApplyWindowInsetsListener { _, insets ->
                val (top, bottom) = if (Build.VERSION.SDK_INT >= 30) {
                    insets.getInsets(WindowInsets.Type.systemBars()).let { it.top to it.bottom }
                } else {
                    @Suppress("DEPRECATION")
                    insets.systemWindowInsetTop to insets.systemWindowInsetBottom
                }
                root.setPadding(dp(16), top + dp(18), dp(16), bottom + dp(24))
                insets
            }
        }
        setContentView(scroll)
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
        modeView.text = mode.label
        reasonView.text = SOURCE_LABELS[p.getString(KEY_SOURCE, "default")] ?: ""
        keyState.text = claudeKey(this)?.let { "● 등록됨  ${maskClaudeKey(it)}" } ?: "○ 미등록 — 아래에 입력하세요"
        keyState.setTextColor(if (claudeKey(this) != null) ACCENT else DIM)
        carState.text = if (p.getBoolean(KEY_CAR, false)) "● 연결됨  ${p.getString(KEY_CAR_NAME, "차량")}" else "○ 연결된 차량 없음"
        carState.setTextColor(if (p.getBoolean(KEY_CAR, false)) ACCENT else DIM)

        // Setup steps disappear once done.
        val needPermissions = PERMISSIONS.any { !granted(this, it) }
        val needBattery = !getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        val needMedia = !mediaAccessGranted(this)
        val needHealth = healthSupported() && !healthGranted(this)
        healthButton.visibility = if (needHealth) View.VISIBLE else View.GONE
        permissionButton.visibility = if (needPermissions) View.VISIBLE else View.GONE
        batteryButton.visibility = if (needBattery) View.VISIBLE else View.GONE
        mediaButton.visibility = if (needMedia) View.VISIBLE else View.GONE
        setupCard.visibility = if (needPermissions || needBattery || needMedia || needHealth) View.VISIBLE else View.GONE
        healthState.text = when {
            !healthSupported() -> "안드로이드 14 이상에서 쓸 수 있어요"
            needHealth -> "○ 연결 안 됨 — 위에서 권한을 허용하세요"
            else -> "● 연결됨"
        }
        healthState.setTextColor(if (healthGranted(this)) ACCENT else DIM)
        stState.text = if (stConnected(this)) "● 연결됨 — 안경에서 \"거실 불 꺼\"처럼 말해 보세요" else "○ 연결 안 됨"
        stState.setTextColor(if (stConnected(this)) ACCENT else DIM)
        // Health Connect allows reads while this screen is open, so refresh the glasses' values now.
        if (healthGranted(this)) Thread { health(this) }.start()

        modeButtons.forEach { (m, b) -> style(b, if (m == override) SELECTED else NORMAL) }

        val at = p.getLong(KEY_SERVED_AT, 0)
        diagnostics.text = buildString {
            append("로컬 서버: ${p.getString(KEY_SERVER, "아직 시작 안 됨")}\n")
            append("받은 요청: ${p.getInt(KEY_SERVED, 0)}회")
            if (at > 0) append(" (마지막 ${SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(at)})")
        }
    }

    // ---------------------------------------------------------------- SmartThings sign-in

    private fun currentSecret() = secret(this, KEY_ST_SECRET) ?: ""

    private fun secretMissing() = secret(this, KEY_ST_SECRET) == null

    /** Signs in inside the app and catches the redirect before it loads, so any https redirect URI works. */
    private fun stLogin() {
        val state = java.util.UUID.randomUUID().toString()
        stLoginState = state
        val dialog = Dialog(this, android.R.style.Theme_Material_NoActionBar)
        val web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    if (!url.startsWith(stRedirect(this@MainActivity))) return false
                    dialog.dismiss()
                    finishStLogin(url)
                    return true
                }
            }
        }
        dialog.setContentView(web)
        dialog.show()
        web.loadUrl(stAuthorizeUrl(this, state))
    }

    private fun finishStLogin(url: String) {
        val uri = Uri.parse(url)
        val code = uri.getQueryParameter("code")
        if (code == null || uri.getQueryParameter("state") != stLoginState) {
            stState.text = "로그인 실패: 돌아온 주소가 올바르지 않아요 (로그인을 다시 시작해 주세요)"
            return
        }
        stLoginState = null
        stState.text = "연결 중…"
        Thread {
            val error = try {
                stExchange(this, code)
                null
            } catch (e: Exception) {
                e.message ?: "알 수 없는 오류"
            }
            runOnUiThread {
                update()
                if (error != null) stState.text = "로그인 실패: $error"
            }
        }.start()
    }

    // ---------------------------------------------------------------- look

    private fun input(hint: String, value: String, password: Boolean = false) = EditText(this).apply {
        this.hint = hint
        setText(value)
        inputType = InputType.TYPE_CLASS_TEXT or (if (password) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_URI)
        isSingleLine = true
        setTextColor(TEXT)
        setHintTextColor(DIM)
        background = rounded(INPUT, LINE, dp(12).toFloat())
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }


    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun rounded(fill: Int, stroke: Int, radius: Float) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radius
        if (stroke != 0) setStroke(dp(1), stroke)
    }

    private fun text(s: String, size: Float, color: Int = TEXT) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
    }

    /** Small spaced capitals, like the glasses page's section labels. */
    private fun label(s: String, color: Int = DIM) = text(s, 11f, color = color).apply {
        letterSpacing = 0.18f
        setTypeface(typeface, Typeface.BOLD)
    }

    private fun note(s: String) = text(s, 13f, color = DIM).apply {
        setPadding(0, dp(8), 0, 0)
        setLineSpacing(0f, 1.15f)
    }

    private fun View.spaced(): View = apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(10)
        }
    }

    private fun row(vararg views: View) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        views.forEach { v ->
            addView(v, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(0, dp(10), dp(8), 0) })
        }
    }

    /** A rounded glass panel with an optional section label. */
    private fun card(title: String?, vararg views: View, strong: Boolean = false) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(if (strong) CARD_STRONG else CARD, if (strong) LINE_STRONG else LINE, dp(20).toFloat())
        setPadding(dp(16), dp(16), dp(16), dp(16))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(12)
        }
        if (title != null) addView(label(title.uppercase(Locale.KOREA)).apply { setPadding(0, 0, 0, dp(8)) })
        views.forEach { v -> if (v.parent == null) addView(v) }
    }

    private fun button(label: String, kind: Int, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        stateListAnimator = null
        minHeight = dp(46)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        style(this, kind)
        setOnClickListener { onClick() }
        if (kind == PRIMARY) {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
        }
    }

    /** Pill buttons: green filled for the main action and the selected mode, outlined otherwise. */
    private fun style(b: Button, kind: Int) {
        val (fill, stroke, textColor) = when (kind) {
            PRIMARY, SELECTED -> Triple(ACCENT, 0, Color.parseColor("#021A0A"))
            DANGER -> Triple(Color.parseColor("#1F1213"), Color.parseColor("#5A2A2C"), Color.parseColor("#FF9B9B"))
            else -> Triple(Color.parseColor("#16211B"), LINE, TEXT)
        }
        b.background = RippleDrawable(ColorStateList.valueOf(Color.parseColor("#33FFFFFF")), rounded(fill, stroke, dp(999).toFloat()), null)
        b.setTextColor(textColor)
        b.setTypeface(Typeface.DEFAULT, if (kind == PRIMARY || kind == SELECTED) Typeface.BOLD else Typeface.NORMAL)
    }

    companion object {
        private val BG = Color.parseColor("#040605")
        private val CARD = Color.parseColor("#0F1612")
        private val CARD_STRONG = Color.parseColor("#0F1C14")
        private val INPUT = Color.parseColor("#070B09")
        private val LINE = Color.parseColor("#1D2E24")
        private val LINE_STRONG = Color.parseColor("#2A5A3A")
        private val TEXT = Color.parseColor("#E8F2EB")
        private val DIM = Color.parseColor("#7F9686")
        private val ACCENT = Color.parseColor("#35F06A")
        private val GLOW = Color.parseColor("#7735F06A")
        private const val NORMAL = 0
        private const val PRIMARY = 1
        private const val DANGER = 2
        private const val SELECTED = 3

        private val PERMISSIONS = listOfNotNull(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACTIVITY_RECOGNITION,
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.POST_NOTIFICATIONS,
            // Runtime-granted only from Android 12; asking for it earlier would never succeed.
            if (Build.VERSION.SDK_INT >= 31) Manifest.permission.BLUETOOTH_CONNECT else null,
        ).toTypedArray()
        private const val HELP = """
자동 감지: 운전(차량 이동·차량 블루투스, 항상 우선) · 러닝(달리기) · 운동(자전거) · 회의(캘린더 '바쁨' 일정)

삼성 모드 및 루틴: 루틴의 동작에서 앱 → '앱 열기 또는 앱 작업' → G2 Context → 'G2 개발 모드' 같은 바로가기를 고르면 장소·와이파이·시간으로 모드가 바뀌어요. 반대 조건의 루틴에는 'G2 자동 모드'를 넣으세요.
"""
    }
}
