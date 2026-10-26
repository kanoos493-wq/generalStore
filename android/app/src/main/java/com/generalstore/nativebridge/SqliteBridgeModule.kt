package com.generalstore.nativebridge

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import java.io.File
import java.util.concurrent.Executors

/**
 * Single-connection SQLite bridge.
 *
 * All statements run on one dedicated thread so transaction state
 * (BEGIN ... COMMIT, SAVEPOINT) is always consistent with the caller.
 * The database is SQLCipher-free: it relies on Android file based encryption.
 * See SECURITY.md for that decision.
 */
class SqliteBridgeModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    private val executor = Executors.newSingleThreadExecutor()
    private var db: SQLiteDatabase? = null
    private var dbFile: File? = null
    private val backupDir: File by lazy {
        File(context.filesDir, "backups").apply { mkdirs() }
    }

    override fun getName(): String = "SqliteBridge"

    private fun requireDb(): SQLiteDatabase =
        db ?: throw IllegalStateException("Database is not open")

    private fun args(params: ReadableArray?): Array<Any?> {
        if (params == null) return emptyArray()
        val out = arrayOfNulls<Any?>(params.size())
        for (i in 0 until params.size()) {
            out[i] = when (params.getType(i)) {
                com.facebook.react.bridge.ReadableType.Null -> null
                com.facebook.react.bridge.ReadableType.Number -> params.getDouble(i)
                com.facebook.react.bridge.ReadableType.Boolean -> if (params.getBoolean(i)) 1.0 else 0.0
                else -> params.getString(i)
            }
        }
        return out
    }

    private fun argsAsStrings(params: ReadableArray?): Array<String?>? {
        if (params == null || params.size() == 0) return null
        val out = arrayOfNulls<String>(params.size())
        for (i in 0 until params.size()) {
            out[i] = when (params.getType(i)) {
                com.facebook.react.bridge.ReadableType.Null -> null
                com.facebook.react.bridge.ReadableType.Number -> {
                    val d = params.getDouble(i)
                    if (d == Math.floor(d) && !d.isInfinite()) d.toLong().toString() else d.toString()
                }
                com.facebook.react.bridge.ReadableType.Boolean -> if (params.getBoolean(i)) "1" else "0"
                else -> params.getString(i)
            }
        }
        return out
    }

    private fun cursorToArray(cursor: Cursor): WritableArray {
        val rows = Arguments.createArray()
        while (cursor.moveToNext()) {
            val row = Arguments.createMap()
            for (i in 0 until cursor.columnCount) {
                val name = cursor.getColumnName(i)
                when (cursor.getType(i)) {
                    Cursor.FIELD_TYPE_NULL -> row.putNull(name)
                    Cursor.FIELD_TYPE_INTEGER -> row.putDouble(name, cursor.getLong(i).toDouble())
                    Cursor.FIELD_TYPE_FLOAT -> row.putDouble(name, cursor.getDouble(i))
                    Cursor.FIELD_TYPE_BLOB -> row.putString(name, String(cursor.getBlob(i)))
                    else -> row.putString(name, cursor.getString(i))
                }
            }
            rows.pushMap(row)
        }
        return rows
    }

    @ReactMethod
    fun open(dbName: String, promise: Promise) {
        executor.execute {
            try {
                val file = context.getDatabasePath(dbName)
                file.parentFile?.mkdirs()
                val database = SQLiteDatabase.openOrCreateDatabase(file, null)
                database.enableWriteAheadLogging()
                database.setForeignKeyConstraintsEnabled(true)
                db = database
                dbFile = file
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_open_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun exec(sql: String, params: ReadableArray?, promise: Promise) {
        executor.execute {
            try {
                val database = requireDb()
                val any = args(params)
                val head = sql.trimStart().uppercase()
                if (head.startsWith("PRAGMA") || head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("VACUUM")) {
                    database.rawQuery(sql, argsAsStrings(params)).use { it.moveToFirst() }
                } else if (any.isEmpty()) {
                    database.execSQL(sql)
                } else {
                    database.execSQL(sql, any)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_exec_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun query(sql: String, params: ReadableArray?, promise: Promise) {
        executor.execute {
            try {
                requireDb().rawQuery(sql, argsAsStrings(params)).use { cursor ->
                    promise.resolve(cursorToArray(cursor))
                }
            } catch (e: Exception) {
                promise.reject("sqlite_query_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun begin(promise: Promise) {
        executor.execute {
            try {
                requireDb().beginTransaction()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_begin_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun commit(promise: Promise) {
        executor.execute {
            try {
                val database = requireDb()
                database.setTransactionSuccessful()
                database.endTransaction()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_commit_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun rollback(promise: Promise) {
        executor.execute {
            try {
                requireDb().endTransaction()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_rollback_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun close(promise: Promise) {
        executor.execute {
            try {
                db?.close()
                db = null
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("sqlite_close_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getPath(promise: Promise) {
        promise.resolve(dbFile?.absolutePath ?: "")
    }

    /** Consistent snapshot via VACUUM INTO, optionally AES-GCM encrypted. */
    @ReactMethod
    fun backupTo(name: String, encrypt: Boolean, promise: Promise) {
        executor.execute {
            try {
                val database = requireDb()
                val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                val target = File(backupDir, safeName)
                if (target.exists()) target.delete()
                val escaped = target.absolutePath.replace("'", "''")
                database.execSQL("VACUUM INTO '$escaped'")

                var finalFile = target
                if (encrypt) {
                    val encrypted = File(backupDir, safeName)
                    KeystoreCrypto.encryptFile(target, encrypted)
                    target.delete()
                    finalFile = encrypted
                }
                val result = Arguments.createMap()
                result.putString("path", finalFile.absolutePath)
                result.putDouble("size", finalFile.length().toDouble())
                result.putString("checksum", KeystoreCrypto.sha256(finalFile))
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("backup_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun listBackups(promise: Promise) {
        executor.execute {
            try {
                val files = Arguments.createArray()
                backupDir.listFiles()?.sortedByDescending { it.lastModified() }?.forEach { file ->
                    val item = Arguments.createMap()
                    item.putString("name", file.name)
                    item.putString("path", file.absolutePath)
                    item.putDouble("size", file.length().toDouble())
                    item.putDouble("mtime", file.lastModified().toDouble())
                    files.pushMap(item)
                }
                promise.resolve(files)
            } catch (e: Exception) {
                promise.reject("list_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun deleteFile(path: String, promise: Promise) {
        executor.execute {
            try {
                promise.resolve(File(path).delete())
            } catch (e: Exception) {
                promise.reject("delete_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun writeFile(folder: String, name: String, content: String, promise: Promise) {
        executor.execute {
            try {
                val dir = File(context.filesDir, folder).apply { mkdirs() }
                val file = File(dir, name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
                file.writeText(content, Charsets.UTF_8)
                promise.resolve(file.absolutePath)
            } catch (e: Exception) {
                promise.reject("write_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun verifyDatabaseFile(path: String, promise: Promise) {
        executor.execute {
            try {
                var probePath = path
                var temporary: File? = null
                if (path.endsWith(".enc")) {
                    val temp = File(context.cacheDir, "verify-${System.currentTimeMillis()}.db")
                    KeystoreCrypto.decryptFile(File(path), temp)
                    probePath = temp.absolutePath
                    temporary = temp
                }
                val probe = SQLiteDatabase.openDatabase(probePath, null, SQLiteDatabase.OPEN_READONLY)
                var integrity = "unknown"
                probe.rawQuery("PRAGMA integrity_check", null).use { cursor ->
                    if (cursor.moveToFirst()) integrity = cursor.getString(0) ?: "unknown"
                }
                var version = 0
                probe.rawQuery("PRAGMA user_version", null).use { cursor ->
                    if (cursor.moveToFirst()) version = cursor.getInt(0)
                }
                probe.close()
                temporary?.delete()
                val result = Arguments.createMap()
                result.putBoolean("ok", integrity.equals("ok", ignoreCase = true))
                result.putString("integrity", integrity)
                result.putDouble("schemaVersion", version.toDouble())
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("verify_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun restore(path: String, promise: Promise) {
        executor.execute {
            try {
                val target = dbFile ?: throw IllegalStateException("Database is not open")
                db?.close()
                db = null

                var source = File(path)
                var temporary: File? = null
                if (path.endsWith(".enc")) {
                    val temp = File(context.cacheDir, "restore-${System.currentTimeMillis()}.db")
                    KeystoreCrypto.decryptFile(source, temp)
                    source = temp
                    temporary = temp
                }

                // keep the current file aside until the copy succeeded
                val previous = File(target.absolutePath + ".previous")
                if (previous.exists()) previous.delete()
                if (target.exists()) target.copyTo(previous, overwrite = true)
                source.inputStream().use { input ->
                    target.outputStream().use { output -> input.copyTo(output) }
                }
                File(target.absolutePath + "-wal").delete()
                File(target.absolutePath + "-shm").delete()
                temporary?.delete()

                val reopened = SQLiteDatabase.openOrCreateDatabase(target, null)
                reopened.enableWriteAheadLogging()
                reopened.setForeignKeyConstraintsEnabled(true)
                db = reopened
                previous.delete()
                promise.resolve(true)
            } catch (e: Exception) {
                try {
                    val target = dbFile
                    if (target != null && !target.exists()) {
                        val previous = File(target.absolutePath + ".previous")
                        if (previous.exists()) previous.copyTo(target, overwrite = true)
                    }
                } catch (_: Exception) {
                    // best effort recovery of the previous database
                }
                promise.reject("restore_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun shareFile(path: String, promise: Promise) {
        try {
            val activity = currentActivity ?: throw IllegalStateException("No activity")
            val file = File(path)
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file,
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = if (path.endsWith(".csv")) "text/csv" else "application/octet-stream"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(android.content.Intent.createChooser(intent, "Share"))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("share_failed", e.message, e)
        }
    }

    @ReactMethod
    fun integrityCheck(promise: Promise) {
        executor.execute {
            try {
                var result = "unknown"
                requireDb().rawQuery("PRAGMA integrity_check", null).use { cursor ->
                    val builder = StringBuilder()
                    while (cursor.moveToNext()) {
                        builder.append(cursor.getString(0)).append('\n')
                    }
                    result = builder.toString().trim()
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("integrity_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun databaseSize(promise: Promise) {
        executor.execute {
            try {
                promise.resolve((dbFile?.length() ?: 0L).toDouble())
            } catch (e: Exception) {
                promise.reject("size_failed", e.message, e)
            }
        }
    }
}
