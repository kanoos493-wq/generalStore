package com.generalstore.nativebridge

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM using a non-exportable Android Keystore key.
 *
 * Used for: PIN verifier / recovery answers (SecureStore) and encrypted
 * backups. The key never leaves the keystore and is deleted when the app data
 * is cleared - which is exactly why SECURITY.md documents that an encrypted
 * backup cannot be recovered after losing the device.
 */
object KeystoreCrypto {
    private const val KEY_ALIAS = "general_store_master_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun isAvailable(): Boolean = try {
        getOrCreateKey()
        true
    } catch (e: Exception) {
        false
    }

    fun encrypt(data: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val body = cipher.doFinal(data)
        return iv + body
    }

    fun decrypt(data: ByteArray): ByteArray {
        if (data.size <= IV_BYTES) throw IllegalArgumentException("Malformed encrypted payload")
        val iv = data.copyOfRange(0, IV_BYTES)
        val body = data.copyOfRange(IV_BYTES, data.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(body)
    }

    fun encryptFile(source: File, target: File) {
        FileOutputStream(target).use { out -> out.write(encrypt(source.readBytes())) }
    }

    fun decryptFile(source: File, target: File) {
        FileOutputStream(target).use { out -> out.write(decrypt(source.readBytes())) }
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
