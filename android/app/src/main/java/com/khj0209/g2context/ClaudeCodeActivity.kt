package com.khj0209.g2context

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Claude Code on the web (claude.ai/code), signed in with the user's Claude account, so sessions can
 * be followed from this app. Claude Code has no public API for third-party apps, so this shows the
 * real web app rather than a copy. Sign-in cookies persist between visits.
 */
class ClaudeCodeActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled") // claude.ai is a JavaScript app; no JS bridge is exposed to it
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val host = request.url.host.orEmpty()
                    if (CLAUDE_HOSTS.any { host == it || host.endsWith(".$it") }) return false
                    // GitHub PRs and other links open in the browser, not inside this screen.
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }
            }
            // Android 15 draws edge to edge: keep the page clear of the status and navigation bars.
            setOnApplyWindowInsetsListener { v, insets ->
                val (top, bottom) = if (Build.VERSION.SDK_INT >= 30) {
                    insets.getInsets(WindowInsets.Type.systemBars()).let { it.top to it.bottom }
                } else {
                    @Suppress("DEPRECATION")
                    insets.systemWindowInsetTop to insets.systemWindowInsetBottom
                }
                v.setPadding(0, top, 0, bottom)
                insets
            }
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        setContentView(web)
        if (savedInstanceState == null) web.loadUrl(URL) else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush() // keep the sign-in
        super.onPause()
    }

    /** Back goes back within Claude Code first, then closes the screen. */
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val URL = "https://claude.ai/code"
        private val CLAUDE_HOSTS = listOf("claude.ai", "claude.com", "anthropic.com")

        fun openInBrowser(activity: Activity) = activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(URL)))
    }
}
