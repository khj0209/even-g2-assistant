package com.khj0209.g2context

import android.content.Context
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// SmartThings, through its REST API with OAuth (personal access tokens now expire after 24 hours).
// The user registers an "OAuth-In" app once (SmartThings CLI: `smartthings apps:create`) and enters its
// client id, secret and redirect URI here. Access tokens last ~24 h and are refreshed automatically;
// each refresh also returns a new refresh token (valid ~30 days), so regular use keeps it alive.

private const val API = "https://api.smartthings.com"
const val ST_DEFAULT_REDIRECT = "https://localhost/g2context"
private const val ST_SCOPES = "r:devices:* x:devices:* r:scenes:* x:scenes:* r:locations:*"

const val KEY_ST_CLIENT = "st_client"
const val KEY_ST_REDIRECT = "st_redirect"
const val KEY_ST_SECRET = "st_secret"
private const val KEY_ST_ACCESS = "st_access"
private const val KEY_ST_REFRESH = "st_refresh"
private const val KEY_ST_EXPIRES = "st_expires"

fun stConnected(ctx: Context) = secret(ctx, KEY_ST_REFRESH) != null

fun stRedirect(ctx: Context) = prefs(ctx).getString(KEY_ST_REDIRECT, null) ?: ST_DEFAULT_REDIRECT

fun stSaveClient(ctx: Context, clientId: String, clientSecret: String, redirect: String) {
    prefs(ctx).edit().putString(KEY_ST_CLIENT, clientId).putString(KEY_ST_REDIRECT, redirect).apply()
    saveSecret(ctx, KEY_ST_SECRET, clientSecret)
}

fun stDisconnect(ctx: Context) {
    saveSecret(ctx, KEY_ST_ACCESS, null)
    saveSecret(ctx, KEY_ST_REFRESH, null)
}

/** The SmartThings sign-in page; `state` is checked when it redirects back. */
fun stAuthorizeUrl(ctx: Context, state: String): String = Uri.parse("$API/oauth/authorize").buildUpon()
    .appendQueryParameter("client_id", prefs(ctx).getString(KEY_ST_CLIENT, ""))
    .appendQueryParameter("response_type", "code")
    .appendQueryParameter("redirect_uri", stRedirect(ctx))
    .appendQueryParameter("scope", ST_SCOPES)
    .appendQueryParameter("state", state)
    .build()
    .toString()

private fun form(vararg pairs: Pair<String, String>) =
    pairs.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }

private fun http(method: String, url: String, headers: Map<String, String>, body: String? = null): Pair<Int, String> {
    val c = URL(url).openConnection() as HttpURLConnection
    c.requestMethod = method
    c.connectTimeout = 10_000
    c.readTimeout = 20_000
    headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
    if (body != null) {
        c.doOutput = true
        c.outputStream.use { it.write(body.toByteArray()) }
    }
    val code = c.responseCode
    val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
    c.disconnect()
    return code to text
}

/** Exchanges the sign-in code (or the refresh token) for tokens and stores them. */
private fun token(ctx: Context, vararg grant: Pair<String, String>) {
    val id = prefs(ctx).getString(KEY_ST_CLIENT, null) ?: throw IOException("SmartThings 앱 정보를 먼저 저장하세요")
    val secretValue = secret(ctx, KEY_ST_SECRET) ?: throw IOException("SmartThings 앱 정보를 먼저 저장하세요")
    val basic = Base64.encodeToString("$id:$secretValue".toByteArray(), Base64.NO_WRAP)
    val (code, text) = http(
        "POST",
        "$API/oauth/token",
        mapOf("Authorization" to "Basic $basic", "Content-Type" to "application/x-www-form-urlencoded"),
        form(*grant, "client_id" to id),
    )
    if (code !in 200..299) {
        // A refresh token that no longer works means signing in again.
        if (grant.any { it.first == "grant_type" && it.second == "refresh_token" }) stDisconnect(ctx)
        throw IOException("SmartThings 로그인 실패 ($code)")
    }
    val j = JSONObject(text)
    saveSecret(ctx, KEY_ST_ACCESS, j.getString("access_token"))
    saveSecret(ctx, KEY_ST_REFRESH, j.getString("refresh_token"))
    prefs(ctx).edit().putLong(KEY_ST_EXPIRES, System.currentTimeMillis() + j.optLong("expires_in", 86_399) * 1000).apply()
}

/** After sign-in: the redirect carries `code`. */
fun stExchange(ctx: Context, code: String) =
    token(ctx, "grant_type" to "authorization_code", "code" to code, "redirect_uri" to stRedirect(ctx))

private val tokenLock = Any()

private fun accessToken(ctx: Context, forceRefresh: Boolean = false): String = synchronized(tokenLock) {
    val refresh = secret(ctx, KEY_ST_REFRESH) ?: throw IOException("G2 Context에서 SmartThings에 로그인하세요")
    val expires = prefs(ctx).getLong(KEY_ST_EXPIRES, 0)
    if (forceRefresh || System.currentTimeMillis() > expires - 5 * 60_000) token(ctx, "grant_type" to "refresh_token", "refresh_token" to refresh)
    secret(ctx, KEY_ST_ACCESS) ?: throw IOException("G2 Context에서 SmartThings에 로그인하세요")
}

private fun api(ctx: Context, method: String, path: String, body: JSONObject? = null, retried: Boolean = false): JSONObject {
    val headers = mapOf("Authorization" to "Bearer ${accessToken(ctx, retried)}", "Content-Type" to "application/json")
    val (code, text) = http(method, "$API$path", headers, body?.toString())
    if (code == 401 && !retried) return api(ctx, method, path, body, retried = true)
    if (code !in 200..299) throw IOException("SmartThings 요청 실패 ($code)")
    return if (text.isBlank()) JSONObject() else JSONObject(text)
}

/** Devices (id, name, capabilities of the main component) and scenes, for Claude to pick from. */
fun stDevices(ctx: Context): JSONObject {
    val devices = JSONArray()
    val items = api(ctx, "GET", "/v1/devices").optJSONArray("items") ?: JSONArray()
    for (i in 0 until items.length()) {
        val d = items.getJSONObject(i)
        val caps = JSONArray()
        val components = d.optJSONArray("components") ?: JSONArray()
        for (c in 0 until components.length()) {
            val comp = components.getJSONObject(c)
            if (comp.optString("id") != "main") continue
            val list = comp.optJSONArray("capabilities") ?: JSONArray()
            for (k in 0 until list.length()) caps.put(list.getJSONObject(k).optString("id"))
        }
        devices.put(
            JSONObject()
                .put("id", d.optString("deviceId"))
                .put("name", d.optString("label").ifEmpty { d.optString("name") })
                .put("capabilities", caps),
        )
    }
    val scenes = JSONArray()
    val sceneItems = api(ctx, "GET", "/v1/scenes").optJSONArray("items") ?: JSONArray()
    for (i in 0 until sceneItems.length()) {
        val s = sceneItems.getJSONObject(i)
        scenes.put(JSONObject().put("id", s.optString("sceneId")).put("name", s.optString("sceneName")))
    }
    return JSONObject().put("devices", devices).put("scenes", scenes)
}

/** The main component's attributes, e.g. {"switch": {"switch": {"value": "on"}}}. */
fun stStatus(ctx: Context, deviceId: String): JSONObject =
    api(ctx, "GET", "/v1/devices/${Uri.encode(deviceId)}/status").optJSONObject("components")?.optJSONObject("main") ?: JSONObject()

/** {"deviceId", "capability", "command", "arguments"} runs a device command; {"sceneId"} runs a scene. */
fun stCommand(ctx: Context, req: JSONObject): JSONObject {
    val scene = req.optString("sceneId")
    if (scene.isNotEmpty()) return api(ctx, "POST", "/v1/scenes/${Uri.encode(scene)}/execute")
    val device = req.optString("deviceId").ifEmpty { throw IOException("deviceId가 없어요") }
    val command = JSONObject()
        .put("component", "main")
        .put("capability", req.optString("capability"))
        .put("command", req.optString("command"))
        .put("arguments", req.optJSONArray("arguments") ?: JSONArray())
    return api(ctx, "POST", "/v1/devices/${Uri.encode(device)}/commands", JSONObject().put("commands", JSONArray().put(command)))
}
