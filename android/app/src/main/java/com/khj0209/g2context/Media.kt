package com.khj0209.g2context

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Notification access is what Android requires before an app may read other apps' media sessions
 * (what's playing). Of the notifications themselves, only the Claude app's are kept: they say when a
 * Claude Code task has finished or needs an approval, which the glasses then show.
 */
class MediaListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in CLAUDE_APPS) return
        val n = sbn.notification
        // Progress ("working…") and group summaries aren't news; the individual notices are.
        if (n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_GROUP_SUMMARY) != 0) return
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return
        latestClaudeNotice = JSONObject().put("id", "${sbn.key}|${sbn.postTime}").put("title", title).put("text", text).put("at", sbn.postTime)
    }

    companion object {
        private val CLAUDE_APPS = setOf("com.anthropic.claude")

        /** The newest Claude app notification, for the paired glasses app. */
        @Volatile var latestClaudeNotice: JSONObject? = null
    }
}

fun mediaAccessGranted(ctx: Context) = ctx.packageName in NotificationManagerCompat.getEnabledListenerPackages(ctx)

/** The session that is playing right now: title, artist, app, position and length (ms). */
fun currentMedia(ctx: Context): JSONObject? {
    val sessions = try {
        ctx.getSystemService(MediaSessionManager::class.java).getActiveSessions(ComponentName(ctx, MediaListener::class.java))
    } catch (e: SecurityException) {
        return null // notification access not granted
    }
    val c = sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: return null
    val md = c.metadata ?: return null
    val title = md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: return null
    val st = c.playbackState!!
    val pos = st.position + ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong()
    // Android 11+ hides most other apps' details; fall back to the package's last word ("youtube").
    val app = try {
        ctx.packageManager.run { getApplicationLabel(getApplicationInfo(c.packageName, 0)).toString() }
    } catch (e: Exception) {
        c.packageName.substringAfterLast('.')
    }
    return JSONObject()
        .put("title", title)
        .put("artist", md.getString(MediaMetadata.METADATA_KEY_ARTIST))
        .put("app", app)
        .put("pos", pos.coerceAtLeast(0))
        .put("dur", md.getLong(MediaMetadata.METADATA_KEY_DURATION))
}

private const val KEY_PAIRING = "pairing"
private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O, 1/I

/** The code the glasses app must send to get media info, so other apps on the phone can't read it. */
fun pairingCode(ctx: Context): String {
    val p = prefs(ctx)
    p.getString(KEY_PAIRING, null)?.let { return it }
    val rnd = SecureRandom()
    val code = (1..8).map { CODE_CHARS[rnd.nextInt(CODE_CHARS.length)] }.joinToString("")
    p.edit().putString(KEY_PAIRING, code).apply()
    return code
}

/** A query parameter of a request target like "/st/status?id=abc&key=X", URL-decoded. */
fun queryParam(target: String, name: String): String? =
    target.substringAfter('?', "").split('&').firstOrNull { it.startsWith("$name=") }
        ?.removePrefix("$name=")
        ?.let { java.net.URLDecoder.decode(it, "UTF-8") }

/** Checks `key=` in a request target like "/mode?key=ABCD2345", in constant time. */
fun hasPairingKey(target: String, code: String): Boolean {
    val key = target.substringAfter('?', "").split('&').firstOrNull { it.startsWith("key=") }?.removePrefix("key=") ?: return false
    return MessageDigest.isEqual(key.toByteArray(), code.toByteArray())
}
