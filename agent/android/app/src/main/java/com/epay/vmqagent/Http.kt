package com.epay.vmqagent

import java.net.HttpURLConnection
import java.net.URL

object Http {
    @JvmStatic fun get(url: String): String = request(url, "GET", null)
    @JvmStatic fun post(url: String, body: String?): String = request(url, "POST", body)
    private fun request(url: String, method: String, body: String?): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000; conn.readTimeout = 8000
        conn.requestMethod = method
        return try {
            if (body != null) { conn.doOutput = true; conn.outputStream.use { it.write(body.toByteArray()) } }
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) { "" } finally { conn.disconnect() }
    }
}
