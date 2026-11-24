package com.khj0209.g2context

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The Claude API key (and SmartThings' credentials) are kept here, encrypted with an AES key that never leaves the Android Keystore.
// The glasses app gets it only over the paired loopback connection and keeps it in memory.

private const val ALIAS = "claude-key"
private const val KEY_CLAUDE = "claude"

private fun aesKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as SecretKey?)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build(),
    )
    return gen.generateKey()
}

fun looksLikeClaudeKey(key: String) = Regex("^sk-ant-[A-Za-z0-9_-]{20,}$").matches(key)

/** "sk-ant-api03-…wxyz" style, never the whole key. */
fun maskClaudeKey(key: String) = "sk-ant-…${key.takeLast(4)}"

/** Stores a secret encrypted with the keystore key under `name` in prefs; null removes it. */
fun saveSecret(ctx: Context, name: String, value: String?) {
    if (value == null) {
        prefs(ctx).edit().remove(name).apply()
        return
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, aesKey()) }
    val ct = cipher.doFinal(value.toByteArray())
    val b64 = { b: ByteArray -> Base64.encodeToString(b, Base64.NO_WRAP) }
    prefs(ctx).edit().putString(name, "${b64(cipher.iv)}.${b64(ct)}").apply()
}

fun secret(ctx: Context, name: String): String? {
    val stored = prefs(ctx).getString(name, null) ?: return null
    return try {
        val (iv, ct) = stored.split('.').map { Base64.decode(it, Base64.NO_WRAP) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, aesKey(), GCMParameterSpec(128, iv)) }
        String(cipher.doFinal(ct))
    } catch (e: Exception) {
        null // keystore key lost (e.g. app data restored elsewhere): the user enters it again
    }
}

fun saveClaudeKey(ctx: Context, key: String?) = saveSecret(ctx, KEY_CLAUDE, key)

fun claudeKey(ctx: Context): String? = secret(ctx, KEY_CLAUDE)
