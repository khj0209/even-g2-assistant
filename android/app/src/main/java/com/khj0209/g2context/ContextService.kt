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
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
        prefs(this).registerOnSharedPreferenceChangeListener(this)
        registerActivityUpdates(this)
        thread(name = "mode-server", isDaemon = true) { serve() }
        handler.post(tick)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

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
                socket.accept().use { respond(it) }
            } catch (e: IOException) {
                // One bad client must not stop the server.
            }
        }
    }

    private fun respond(client: Socket) {
        client.soTimeout = 2000
        val reader = client.getInputStream().bufferedReader()
        val request = reader.readLine() ?: return
        while (!reader.readLine().isNullOrEmpty()) Unit // skip headers
        // The glasses page isn't served from localhost, so allow CORS and Chrome's private-network preflight.
        val cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n" +
            "Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\n"
        val (mode, source) = current
        // Any app on the phone can read this, so it carries no calendar details beyond the end time,
        // and what's playing only for a request with the pairing code shown in this app.
        val json = JSONObject().put("mode", mode.id).put("label", mode.label).put("source", source)
        meetingEndsAt?.let { if (mode == Mode.MEETING) json.put("end", it) }
        if (hasPairingKey(request.split(' ').getOrElse(1) { "" }, pairingCode(this))) currentMedia(this)?.let { json.put("media", it) }
        val body = json.toString().toByteArray()
        val head = when {
            request.startsWith("OPTIONS ") -> "HTTP/1.1 204 No Content\r\n$cors"
            request.startsWith("GET /mode") ->
                "HTTP/1.1 200 OK\r\n${cors}Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${body.size}\r\n"
            else -> "HTTP/1.1 404 Not Found\r\n${cors}Content-Length: 0\r\n"
        }
        val out = client.getOutputStream()
        out.write("${head}Connection: close\r\n\r\n".toByteArray())
        if (request.startsWith("GET /mode")) out.write(body)
        out.flush()
        val p = prefs(this)
        p.edit().putInt(KEY_SERVED, p.getInt(KEY_SERVED, 0) + 1).putLong(KEY_SERVED_AT, System.currentTimeMillis()).apply()
    }

    companion object {
        const val PORT = 8765
        private const val CHANNEL = "context"
        private const val NOTIFICATION_ID = 1
    }
}
