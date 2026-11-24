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
    fun parsesIds() {
        assertEquals(Mode.WORKOUT, Mode.of("workout"))
        assertEquals(null, Mode.of("auto"))
    }
}
