package com.generalstore.nativebridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.SecureRandom

/**
 * Keystore-backed key/value storage for the PIN verifier and recovery answers.
 * Values are AES-GCM encrypted before touching SharedPreferences, and the key
 * is stored in the Android Keystore (never exportable).
 */
class SecureStoreModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences("general_store_secure", Context.MODE_PRIVATE)
    }

    override fun getName(): String = "SecureStore"

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) {
        try {
            val encrypted = KeystoreCrypto.encrypt(value.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(key, Base64.encodeToString(encrypted, Base64.NO_WRAP)).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("secure_set_failed", e.message, e)
        }
    }

    @ReactMethod
    fun getItem(key: String, promise: Promise) {
        try {
            val stored = prefs.getString(key, null) ?: return promise.resolve(null)
            val decrypted = KeystoreCrypto.decrypt(Base64.decode(stored, Base64.NO_WRAP))
            promise.resolve(String(decrypted, Charsets.UTF_8))
        } catch (e: Exception) {
            // A corrupt or undecryptable value must never unlock the app.
            promise.reject("secure_get_failed", e.message, e)
        }
    }

    @ReactMethod
    fun removeItem(key: String, promise: Promise) {
        try {
            prefs.edit().remove(key).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("secure_remove_failed", e.message, e)
        }
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(KeystoreCrypto.isAvailable())
    }

    /**
     * Cryptographically strong random bytes for the JS layer (PIN salts and
     * recovery salts). Java/Kotlin has no Web Crypto, and React Native does not
     * provide `crypto.getRandomValues`, so this is the platform CSPRNG bridge:
     * the bytes come from Android's SecureRandom, seeded by the OS.
     *
     * Returned as a hex string so the JS side needs no base64 decoder.
     */
    @ReactMethod
    fun randomHex(count: Double, promise: Promise) {
        try {
            val size = count.toInt().coerceIn(1, 4096)
            val bytes = ByteArray(size)
            SecureRandom().nextBytes(bytes)
            promise.resolve(hexOf(bytes))
        } catch (e: Exception) {
            promise.reject("random_failed", e.message, e)
        }
    }

    private fun hexOf(bytes: ByteArray): String {
        val digits = "0123456789abcdef"
        val out = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            out.append(digits[v ushr 4]).append(digits[v and 0x0f])
        }
        return out.toString()
    }

    @ReactMethod
    fun decryptFile(path: String, promise: Promise) {
        try {
            val source = File(path)
            val target = File(context.cacheDir, "decrypted-${System.currentTimeMillis()}.db")
            KeystoreCrypto.decryptFile(source, target)
            promise.resolve(target.absolutePath)
        } catch (e: Exception) {
            promise.reject("decrypt_failed", e.message, e)
        }
    }

    @ReactMethod
    fun sha256OfFile(path: String, promise: Promise) {
        try {
            promise.resolve(KeystoreCrypto.sha256(File(path)))
        } catch (e: Exception) {
            promise.reject("hash_failed", e.message, e)
        }
    }
}
