package com.generalstore.nativebridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

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
