package com.khj0209.g2context

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * Keeps the current mode up to date and serves it to the G2 glasses app (running in the Even app
 * on this phone) at http://127.0.0.1:8765/mode. Loopback only; read-only.
 */
class ContextService : Service(), SharedPreferences.OnSharedPreferenceChangeListener {
    @Volatile private var current: Pair<Mode, String> = Mode.ASSISTANT to "default"
    @Volatile private var meetingEndsAt: Long? = null
    private var server: ServerSocket? = null
    private val handler = Handler(Looper.getMainLooper())
    // Calendar meetings start and end without any event we could listen to, so re-check regularly.
    private val tick = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, 30_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "현재 상황", NotificationManager.IMPORTANCE_LOW),
        )
        current = compute()
        goForeground()
        prefs(this).registerOnSharedPreferenceChangeListener(this)
        registerActivityUpdates(this)
        thread(name = "mode-server", isDaemon = true) { serve() }
        handler.post(tick)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground() // again, so a microphone permission granted since then takes effect
        return START_STICKY
    }

    /**
     * Speech recognition for the glasses runs while the phone sits in a pocket, which Android only
     * allows for a foreground service of the microphone type. That type can only be added when the
     * permission is granted and the service was started from the foreground, so fall back without it.
     */
    private fun goForeground() {
        val special = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        val mic = if (Build.VERSION.SDK_INT >= 30 && granted(this, android.Manifest.permission.RECORD_AUDIO)) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            0
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), special or mic)
        } catch (e: Exception) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), special)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        prefs(this).unregisterOnSharedPreferenceChangeListener(this)
        server?.close()
        prefs(this).edit().putString(KEY_SERVER, "꺼짐").apply()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onSharedPreferenceChanged(p: SharedPreferences?, key: String?) {
        if (key == KEY_OVERRIDE || key == KEY_ACTIVITY) refresh()
    }

    private fun compute(): Pair<Mode, String> {
        val p = prefs(this)
        meetingEndsAt = meetingEnd(this)
        return Mode.resolve(Mode.of(p.getString(KEY_OVERRIDE, null)), Mode.of(p.getString(KEY_ACTIVITY, null)), meetingEndsAt != null)
    }

    private fun refresh() {
        val next = compute()
        if (next == current && prefs(this).contains(KEY_CURRENT)) return
        current = next
        prefs(this).edit().putString(KEY_CURRENT, next.first.id).putString(KEY_SOURCE, next.second).apply()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
    }

    private fun notification(): Notification {
        val (mode, source) = current
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("G2: ${mode.label} 모드")
            .setContentText(SOURCE_LABELS[source])
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    private fun serve() {
        val socket = try {
            ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1"))
        } catch (e: IOException) {
            prefs(this).edit().putString(KEY_SERVER, "시작 실패: ${e.message}").apply()
            return
        }
        server = socket
        prefs(this).edit().putString(KEY_SERVER, "실행 중 (127.0.0.1:$PORT)").apply()
        while (!socket.isClosed) {
            try {
                val client = socket.accept()
                // One thread per request: speech recognition takes seconds and mode polls must not wait for it.
                thread(name = "mode-request", isDaemon = true) {
                    try {
                        client.use { respond(it) }
                    } catch (e: IOException) {
                        // One bad client must not stop the server.
                    }
                }
            } catch (e: IOException) {
                // accept() failed; keep serving unless the socket was closed.
            }
        }
    }

    private fun respond(client: Socket) {
        client.soTimeout = 5000
        val input = BufferedInputStream(client.getInputStream())
        val request = readLine(input) ?: return
        var length = 0
        while (true) {
            val h = readLine(input) ?: return
            if (h.isEmpty()) break
            if (h.startsWith("content-length:", ignoreCase = true)) length = h.substringAfter(':').trim().toIntOrNull() ?: 0
        }
        val target = request.split(' ').getOrElse(1) { "" }
        // Any app on the phone can call this server. Without the pairing code shown in this app it only
        // gets the mode (and a meeting's end time); the Claude key, what's playing and speech recognition need the code.
        val paired = hasPairingKey(target, pairingCode(this))
        val (status, json) = when {
            request.startsWith("OPTIONS ") -> "204 No Content" to null
            request.startsWith("GET /mode") -> "200 OK" to modeJson(paired)
            request.startsWith("POST /stt") -> stt(input, length, paired)
            else -> "404 Not Found" to null
        }
        val body = json?.toString()?.toByteArray() ?: ByteArray(0)
        // The glasses page isn't served from localhost, so allow CORS and Chrome's private-network preflight.
        val head = "HTTP/1.1 $status\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n" +
            "Access-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Headers: *\r\n" +
            "Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n" +
            "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        val out = client.getOutputStream()
        out.write(head.toByteArray())
        out.write(body)
        out.flush()
        val p = prefs(this)
        p.edit().putInt(KEY_SERVED, p.getInt(KEY_SERVED, 0) + 1).putLong(KEY_SERVED_AT, System.currentTimeMillis()).apply()
    }

    private fun modeJson(paired: Boolean): JSONObject {
        val (mode, source) = current
        val json = JSONObject().put("mode", mode.id).put("label", mode.label).put("source", source)
        meetingEndsAt?.let { if (mode == Mode.MEETING) json.put("end", it) }
        if (paired) {
            currentMedia(this)?.let { json.put("media", it) }
            claudeKey(this)?.let { json.put("claudeKey", it) }
        }
        return json
    }

    private fun stt(input: BufferedInputStream, length: Int, paired: Boolean): Pair<String, JSONObject> {
        if (!paired) return "403 Forbidden" to JSONObject().put("error", "연결 코드가 G2 Context와 달라요")
        if (length <= 0 || length > MAX_PCM) return "413 Payload Too Large" to JSONObject().put("error", "녹음이 너무 길어요")
        val pcm = ByteArray(length)
        DataInputStream(input).readFully(pcm)
        return try {
            "200 OK" to JSONObject().put("text", transcribe(this, pcm))
        } catch (e: IOException) {
            "503 Service Unavailable" to JSONObject().put("error", e.message)
        }
    }

    /** One header line, without its CRLF; null at end of stream. Headers are ASCII, the body is read raw. */
    private fun readLine(input: BufferedInputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
        }
    }

    companion object {
        const val PORT = 8765
        /** A minute of 16 kHz 16-bit mono audio, plus slack. */
        private const val MAX_PCM = 2_000_000
        private const val CHANNEL = "context"
        private const val NOTIFICATION_ID = 1
    }
}
