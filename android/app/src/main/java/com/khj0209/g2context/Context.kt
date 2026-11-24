package com.khj0209.g2context

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.provider.CalendarContract.Instances
import androidx.core.content.IntentCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

// Shared state, kept in one SharedPreferences file. ContextService listens to it and recomputes.
const val KEY_OVERRIDE = "override" // mode set by a Samsung routine shortcut or by hand
const val KEY_ACTIVITY = "activity" // mode implied by the current motion
const val KEY_CURRENT = "current"
const val KEY_SOURCE = "source"
const val KEY_SERVER = "server" // local server state, for the diagnostics on the main screen
const val KEY_SERVED = "served" // requests answered, and when the last one came
const val KEY_SERVED_AT = "served_at"
const val KEY_CAR = "car" // a car's Bluetooth (car audio / hands-free) is connected
const val KEY_CAR_NAME = "car_name"
const val KEY_CAR_ONLY = "car_only" // count vehicle motion as driving only with the car's Bluetooth

fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("context", Context.MODE_PRIVATE)

fun granted(ctx: Context, permission: String) = ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

val SOURCE_LABELS = mapOf("car" to "차량 블루투스 연결", "activity" to "움직임 감지", "routine" to "루틴/직접 지정", "calendar" to "캘린더", "default" to "기본")

fun startContextService(ctx: Context) {
    try {
        ctx.startForegroundService(Intent(ctx, ContextService::class.java))
    } catch (e: Exception) {
        // Android 12+ refuses to start it from the background; the next app/routine launch will.
    }
}

/** When the busy, non-all-day calendar event happening now ends (ms), or null when there is none. */
fun meetingEnd(ctx: Context): Long? {
    if (!granted(ctx, Manifest.permission.READ_CALENDAR)) return null
    val now = System.currentTimeMillis()
    val cursor = Instances.query(ctx.contentResolver, arrayOf(Instances.ALL_DAY, Instances.AVAILABILITY, Instances.END), now, now + 1)
        ?: return null
    cursor.use {
        while (it.moveToNext()) if (it.getInt(0) == 0 && it.getInt(1) == Instances.AVAILABILITY_BUSY) return it.getLong(2)
    }
    return null
}

/** The next busy, non-all-day event starting within 12 hours: title and start (ms). */
fun nextEvent(ctx: Context): Pair<String, Long>? {
    if (!granted(ctx, Manifest.permission.READ_CALENDAR)) return null
    val now = System.currentTimeMillis()
    val cursor = Instances.query(
        ctx.contentResolver,
        arrayOf(Instances.ALL_DAY, Instances.AVAILABILITY, Instances.BEGIN, Instances.TITLE),
        now,
        now + 12 * 3_600_000L,
    ) ?: return null
    var best: Pair<String, Long>? = null
    cursor.use {
        while (it.moveToNext()) {
            val begin = it.getLong(2)
            if (it.getInt(0) != 0 || it.getInt(1) != Instances.AVAILABILITY_BUSY || begin <= now) continue
            val current = best
            if (current == null || begin < current.second) best = (it.getString(3) ?: "일정") to begin
        }
    }
    return best
}

/** Car audio and hands-free kits: what a car's Bluetooth reports itself as. */
@SuppressLint("MissingPermission")
private fun isCar(device: BluetoothDevice?): Boolean = try {
    device?.bluetoothClass?.deviceClass in setOf(
        BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO,
        BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE,
    )
} catch (e: SecurityException) {
    false // Bluetooth permission not granted
}

/** Notes when the car's Bluetooth connects or disconnects. */
class CarReceiver : BroadcastReceiver() {
    @SuppressLint("MissingPermission")
    override fun onReceive(ctx: Context, intent: Intent) {
        val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        if (!isCar(device)) return
        val connected = intent.action == BluetoothDevice.ACTION_ACL_CONNECTED
        val name = try {
            device?.name
        } catch (e: SecurityException) {
            null
        }
        prefs(ctx).edit().putBoolean(KEY_CAR, connected).putString(KEY_CAR_NAME, name ?: "차량").apply()
        if (connected) startContextService(ctx)
    }
}

private val MOTION_TYPES = listOf(
    DetectedActivity.IN_VEHICLE, DetectedActivity.RUNNING, DetectedActivity.ON_BICYCLE,
    DetectedActivity.WALKING, DetectedActivity.STILL,
)

private fun motionMode(type: Int): Mode? = when (type) {
    DetectedActivity.IN_VEHICLE -> Mode.DRIVING
    DetectedActivity.RUNNING -> Mode.RUNNING
    DetectedActivity.ON_BICYCLE -> Mode.WORKOUT
    else -> null
}

/** Subscribes to motion changes (driving / running / cycling / walking / still). Lost on reboot, so re-run then. */
@SuppressLint("MissingPermission")
fun registerActivityUpdates(ctx: Context) {
    if (!granted(ctx, Manifest.permission.ACTIVITY_RECOGNITION)) return
    val transitions = MOTION_TYPES.flatMap { type ->
        listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER, ActivityTransition.ACTIVITY_TRANSITION_EXIT).map {
            ActivityTransition.Builder().setActivityType(type).setActivityTransition(it).build()
        }
    }
    val intent = PendingIntent.getBroadcast(
        ctx, 0, Intent(ctx, ActivityReceiver::class.java),
        // Mutable: Play services adds the result to this intent.
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
    ActivityRecognition.getClient(ctx).requestActivityTransitionUpdates(ActivityTransitionRequest(transitions), intent)
}

class ActivityReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val result = ActivityTransitionResult.extractResult(intent) ?: return
        val p = prefs(ctx)
        for (e in result.transitionEvents) {
            val mode = motionMode(e.activityType)
            if (e.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
                // Walking or standing still clears a previous driving/running/cycling state.
                p.edit().putString(KEY_ACTIVITY, mode?.id).apply()
            } else if (mode != null && mode.id == p.getString(KEY_ACTIVITY, null)) {
                p.edit().remove(KEY_ACTIVITY).apply()
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // A connection from before the reboot is gone; the next one will be reported again.
            if (intent.action == Intent.ACTION_BOOT_COMPLETED) prefs(ctx).edit().putBoolean(KEY_CAR, false).apply()
            startContextService(ctx)
        }
    }
}
