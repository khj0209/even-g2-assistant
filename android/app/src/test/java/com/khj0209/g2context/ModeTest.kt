package com.khj0209.g2context

import org.junit.Assert.assertEquals
import org.junit.Test

class ModeTest {
    @Test
    fun drivingAlwaysWins() {
        assertEquals(Mode.DRIVING to "activity", Mode.resolve(Mode.DEV, Mode.DRIVING, true))
    }

    @Test
    fun routineBeatsMotionAndCalendar() {
        assertEquals(Mode.DEV to "routine", Mode.resolve(Mode.DEV, Mode.RUNNING, true))
    }

    @Test
    fun motionThenCalendarThenDefault() {
        assertEquals(Mode.RUNNING to "activity", Mode.resolve(null, Mode.RUNNING, true))
        assertEquals(Mode.MEETING to "calendar", Mode.resolve(null, null, true))
        assertEquals(Mode.ASSISTANT to "default", Mode.resolve(null, null, false))
    }

    @Test
    fun carBluetoothMeansDriving() {
        assertEquals(Mode.DRIVING to "car", Mode.resolve(Mode.DEV, null, true, carConnected = true))
    }

    @Test
    fun carOnlyIgnoresVehicleMotionWithoutTheCar() {
        // A bus or taxi passenger: motion says vehicle, but this isn't the wearer's car.
        assertEquals(Mode.ASSISTANT to "default", Mode.resolve(null, Mode.DRIVING, false, carOnly = true))
        assertEquals(Mode.DRIVING to "activity", Mode.resolve(null, Mode.DRIVING, false, carOnly = false))
    }

    @Test
    fun parsesIds() {
        assertEquals(Mode.WORKOUT, Mode.of("workout"))
        assertEquals(null, Mode.of("auto"))
    }
}

class PairingTest {
    @Test
    fun acceptsOnlyTheExactKey() {
        assertEquals(true, hasPairingKey("/mode?key=ABCD2345", "ABCD2345"))
        assertEquals(true, hasPairingKey("/mode?x=1&key=ABCD2345", "ABCD2345"))
        assertEquals(false, hasPairingKey("/mode?key=ABCD234", "ABCD2345"))
        assertEquals(false, hasPairingKey("/mode", "ABCD2345"))
        assertEquals(false, hasPairingKey("/mode?key=", "ABCD2345"))
    }
}

class ClaudeKeyTest {
    @Test
    fun validatesAndMasks() {
        assertEquals(true, looksLikeClaudeKey("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV"))
        assertEquals(false, looksLikeClaudeKey("sk-proj-ABCDEFGHIJKLMNOPQRSTUV"))
        assertEquals(false, looksLikeClaudeKey("sk-ant-short"))
        assertEquals("sk-ant-…wxyz", maskClaudeKey("sk-ant-api03-ABCDEFGHIJKLMNOPwxyz"))
    }
}
