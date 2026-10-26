package com.generalstore.nativebridge

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Printing:
 *  - `printText` renders plain text to PDF and hands it to the Android print
 *    framework (works with any installed print service, incl. PDF export).
 *  - `printBluetooth` writes raw ESC/POS bytes to a paired SPP printer.
 *
 * Not every thermal printer speaks SPP/ESC-POS; PRINTER notes in README.md.
 */
class PrinterBridgeModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    private val executor = Executors.newSingleThreadExecutor()
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    override fun getName(): String = "PrinterBridge"

    private fun hasBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        try {
            val adapter = BluetoothAdapter.getDefaultAdapter()
            promise.resolve(adapter != null && adapter.isEnabled)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun listPairedDevices(promise: Promise) {
        try {
            if (!hasBluetoothPermission()) {
                promise.reject("bluetooth_permission", "Bluetooth permission is not granted")
                return
            }
            val adapter = BluetoothAdapter.getDefaultAdapter()
                ?: run { promise.reject("no_bluetooth", "Bluetooth is not available"); return }
            val list = Arguments.createArray()
            adapter.bondedDevices?.forEach { device: BluetoothDevice ->
                val item = Arguments.createMap()
                item.putString("name", device.name ?: "Unknown")
                item.putString("address", device.address)
                list.pushMap(item)
            }
            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("bluetooth_list_failed", e.message, e)
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    fun printBluetooth(address: String, text: String, promise: Promise) {
        executor.execute {
            try {
                if (!hasBluetoothPermission()) {
                    promise.reject("bluetooth_permission", "Bluetooth permission is not granted")
                    return@execute
                }
                val adapter = BluetoothAdapter.getDefaultAdapter()
                    ?: throw IllegalStateException("Bluetooth is not available")
                val device = adapter.getRemoteDevice(address)
                adapter.cancelDiscovery()
                val socket = device.createRfcommSocketToServiceRecord(sppUuid)
                try {
                    socket.connect()
                    val out = socket.outputStream
                    out.write(byteArrayOf(0x1B, 0x40)) // ESC @ init
                    out.write(text.toByteArray(Charsets.UTF_8))
                    out.write(byteArrayOf(0x0A, 0x0A, 0x0A))
                    out.flush()
                    promise.resolve(true)
                } finally {
                    try {
                        socket.close()
                    } catch (_: Exception) {
                        // ignore
                    }
                }
            } catch (e: Exception) {
                promise.reject("print_failed", e.message, e)
            }
        }
    }

    @ReactMethod
    fun printText(text: String, fontSize: Int, jobName: String, promise: Promise) {
        try {
            val activity = currentActivity ?: throw IllegalStateException("No activity")
            val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
            val adapter = TextPrintAdapter(context, jobName, text, fontSize.toFloat())
            val attributes = PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize("roll_58", "58mm roll", 2283, 11693))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                .build()
            printManager.print(jobName, adapter, attributes)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("print_text_failed", e.message, e)
        }
    }

    private class TextPrintAdapter(
        private val context: Context,
        private val jobName: String,
        private val text: String,
        private val textSize: Float,
    ) : PrintDocumentAdapter() {

        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: android.os.CancellationSignal?,
            callback: LayoutResultCallback?,
            extras: android.os.Bundle?,
        ) {
            val info = PrintDocumentInfo.Builder("$jobName.pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .build()
            callback?.onLayoutFinished(info, true)
        }

        override fun onWrite(
            pages: Array<out android.print.PageRange>?,
            destination: android.os.ParcelFileDescriptor?,
            cancellationSignal: android.os.CancellationSignal?,
            callback: WriteResultCallback?,
        ) {
            val lines = text.split("\n")
            val paint = Paint().apply {
                this.textSize = textSize
                typeface = Typeface.MONOSPACE
                isAntiAlias = true
            }
            val document = PdfDocument()
            val pageHeight = 842 // A5-ish fallback if roll paper is not honoured
            val pageWidth = 226
            try {
                var index = 0
                var pageNumber = 1
                while (index < lines.size && pageNumber <= 60) {
                    val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create()
                    val page = document.startPage(pageInfo)
                    var y = textSize + 4f
                    while (index < lines.size && y < pageHeight - 4f) {
                        page.canvas.drawText(lines[index], 4f, y, paint)
                        y += textSize * 1.22f
                        index += 1
                    }
                    document.finishPage(page)
                    pageNumber += 1
                }
                destination?.let { descriptor ->
                    FileOutputStream(descriptor.fileDescriptor).use { output ->
                        document.writeTo(output)
                    }
                }
                callback?.onWriteFinished(arrayOf(android.print.PageRange.ALL_PAGES))
            } catch (e: Exception) {
                callback?.onWriteFailed(e.message)
            } finally {
                document.close()
            }
        }
    }
}
