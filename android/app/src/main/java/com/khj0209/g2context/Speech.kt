package com.khj0209.g2context

import android.Manifest
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Turns the glasses' microphone audio (16 kHz, 16-bit, mono PCM) into text with the phone's own speech
 * recognizer, so no API key is needed. Blocks; call it off the main thread.
 */
fun transcribe(ctx: Context, pcm: ByteArray): String {
    if (Build.VERSION.SDK_INT < 33) throw IOException("안드로이드 13 이상에서만 안경 마이크 음성 인식을 쓸 수 있어요")
    if (!granted(ctx, Manifest.permission.RECORD_AUDIO)) throw IOException("G2 Context 앱에서 마이크 권한을 허용해 주세요")
    val (readEnd, writeEnd) = ParcelFileDescriptor.createPipe()
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, readEnd)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16_000)
    val done = CountDownLatch(1)
    var text: String? = null
    var error: String? = null
    var recognizer: SpeechRecognizer? = null
    val main = Handler(Looper.getMainLooper())
    main.post {
        try {
            val r = if (SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx)
            else SpeechRecognizer.createSpeechRecognizer(ctx)
            recognizer = r
            r.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    done.countDown()
                }

                override fun onError(code: Int) {
                    when (code) {
                        // Nothing intelligible was said: not an error for push-to-talk.
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> text = ""
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> {
                            r.triggerModelDownload(intent)
                            error = "한국어 음성 인식 모델을 내려받고 있어요. 잠시 후 다시 말해 주세요"
                        }
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> error = "G2 Context 앱에서 마이크 권한을 허용해 주세요"
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> error = "음성 인식기가 다른 작업 중이에요"
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
                            error = "음성 인식 서버에 연결할 수 없어요"
                        else -> error = "음성 인식 오류 ($code)"
                    }
                    done.countDown()
                }

                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            r.startListening(intent)
        } catch (e: Exception) {
            error = "음성 인식을 시작할 수 없어요 (${e.message})"
            done.countDown()
        }
    }
    // The pipe holds only ~64 KB, so feed it from another thread while the recognizer reads; closing ends the audio.
    thread(name = "stt-feed") {
        try {
            ParcelFileDescriptor.AutoCloseOutputStream(writeEnd).use { it.write(pcm) }
        } catch (e: IOException) {
            // The recognizer stopped reading (error or result already in).
        }
    }
    val finished = done.await(30, TimeUnit.SECONDS)
    main.post { recognizer?.destroy() }
    readEnd.close()
    error?.let { throw IOException(it) }
    if (!finished) throw IOException("음성 인식 시간이 초과됐어요")
    return text.orEmpty()
}
