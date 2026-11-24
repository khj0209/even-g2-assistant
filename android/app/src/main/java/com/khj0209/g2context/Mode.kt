package com.khj0209.g2context

/** Situations the glasses assistant adapts to. Ids are shared with the glasses app (src/core/modes.ts). */
enum class Mode(val id: String, val label: String) {
    ASSISTANT("assistant", "일상"),
    RUNNING("running", "러닝"),
    WORKOUT("workout", "운동"),
    DRIVING("driving", "운전"),
    DEV("dev", "개발"),
    MEETING("meeting", "회의");

    companion object {
        fun of(id: String?): Mode? = entries.firstOrNull { it.id == id }

        /**
         * Picks the current mode. Driving wins over everything, a mode set by a Samsung routine or by
         * hand comes next, then running/cycling from motion, then a calendar meeting.
         * Driving: the car's Bluetooth is connected, or vehicle motion is detected. With `carOnly`, motion
         * alone isn't enough (a bus or taxi passenger), only the car's Bluetooth counts.
         */
        fun resolve(
            override: Mode?,
            activity: Mode?,
            inMeeting: Boolean,
            carConnected: Boolean = false,
            carOnly: Boolean = false,
        ): Pair<Mode, String> = when {
            carConnected -> DRIVING to "car"
            activity == DRIVING && !carOnly -> DRIVING to "activity"
            override != null -> override to "routine"
            activity != null && activity != DRIVING -> activity to "activity"
            inMeeting -> MEETING to "calendar"
            else -> ASSISTANT to "default"
        }
    }
}
