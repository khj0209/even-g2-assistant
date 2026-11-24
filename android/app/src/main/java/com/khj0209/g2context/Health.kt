package com.khj0209.g2context

import android.content.Context
import android.health.connect.AggregateRecordsRequest
import android.health.connect.AggregateRecordsResponse
import android.health.connect.HealthConnectException
import android.health.connect.HealthConnectManager
import android.health.connect.ReadRecordsRequestUsingFilters
import android.health.connect.ReadRecordsResponse
import android.health.connect.TimeInstantRangeFilter
import android.health.connect.datatypes.HeartRateRecord
import android.health.connect.datatypes.SleepSessionRecord
import android.health.connect.datatypes.StepsRecord
import android.os.Build
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

// Samsung Health shares steps, heart rate and sleep through Health Connect, which is built into
// Android 14+. Reading it needs the user's per-type permission, granted in Health Connect's own screen.

val HEALTH_PERMISSIONS: Array<String> = buildList {
    add("android.permission.health.READ_STEPS")
    add("android.permission.health.READ_SLEEP")
    add("android.permission.health.READ_HEART_RATE")
    // Android 15+: lets the glasses get fresh values while this app isn't on screen.
    if (Build.VERSION.SDK_INT >= 35) add("android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND")
}.toTypedArray()

fun healthSupported() = Build.VERSION.SDK_INT >= 34

fun healthGranted(ctx: Context) = healthSupported() && HEALTH_PERMISSIONS.take(3).all { granted(ctx, it) }

@Volatile private var cached: JSONObject? = null
@Volatile private var cachedAt = 0L

/**
 * Today's steps, last night's sleep and the latest heart rate, cached for a minute. A read that fails
 * (no permission, or Health Connect refusing a background read) keeps the last good values.
 */
fun health(ctx: Context): JSONObject? {
    if (!healthGranted(ctx)) return null
    if (System.currentTimeMillis() - cachedAt > 60_000) {
        cachedAt = System.currentTimeMillis()
        readHealth(ctx)?.let { cached = it }
    }
    return cached
}

@RequiresApi(34)
private fun <T> await(call: (Executor, OutcomeReceiver<T, HealthConnectException>) -> Unit): T? {
    val done = CountDownLatch(1)
    var out: T? = null
    call(Executor { it.run() }, object : OutcomeReceiver<T, HealthConnectException> {
        override fun onResult(result: T) {
            out = result
            done.countDown()
        }

        override fun onError(error: HealthConnectException) {
            done.countDown()
        }
    })
    done.await(5, TimeUnit.SECONDS)
    return out
}

private fun readHealth(ctx: Context): JSONObject? {
    if (Build.VERSION.SDK_INT < 34) return null
    val hc = ctx.getSystemService(HealthConnectManager::class.java) ?: return null
    val zone = ZoneId.systemDefault()
    val now = Instant.now()
    val range = { from: Instant -> TimeInstantRangeFilter.Builder().setStartTime(from).setEndTime(now).build() }
    val json = JSONObject()

    val stepsReq = AggregateRecordsRequest.Builder<Long>(range(LocalDate.now(zone).atStartOfDay(zone).toInstant()))
        .addAggregationType(StepsRecord.STEPS_COUNT_TOTAL)
        .build()
    await<AggregateRecordsResponse<Long>> { ex, cb -> hc.aggregate(stepsReq, ex, cb) }
        ?.get(StepsRecord.STEPS_COUNT_TOTAL)
        ?.let { json.put("steps", it) }

    val sleepReq = ReadRecordsRequestUsingFilters.Builder(SleepSessionRecord::class.java)
        .setTimeRangeFilter(range(now.minus(Duration.ofHours(24))))
        .build()
    await<ReadRecordsResponse<SleepSessionRecord>> { ex, cb -> hc.readRecords(sleepReq, ex, cb) }
        ?.records
        ?.maxByOrNull { it.endTime }
        ?.let { json.put("sleepMin", Duration.between(it.startTime, it.endTime).toMinutes()) }

    // The watch syncs all-day heart rate to the phone in batches, so the newest sample can be minutes old.
    val hrReq = ReadRecordsRequestUsingFilters.Builder(HeartRateRecord::class.java)
        .setTimeRangeFilter(range(now.minus(Duration.ofHours(2))))
        .setAscending(false)
        .setPageSize(5)
        .build()
    await<ReadRecordsResponse<HeartRateRecord>> { ex, cb -> hc.readRecords(hrReq, ex, cb) }
        ?.records
        ?.flatMap { it.samples }
        ?.maxByOrNull { it.time }
        ?.let { json.put("hr", it.beatsPerMinute).put("hrAt", it.time.toEpochMilli()) }

    return if (json.length() > 0) json else null
}
