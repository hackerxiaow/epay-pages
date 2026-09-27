package com.epay.vmqagent

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var sp: SharedPreferences
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sp = getSharedPreferences("vmq", MODE_PRIVATE)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        val server = EditText(this).apply { hint = "服务器地址 如 https://epay-pages.pages.dev"; setText(sp.getString("server", "")) }
        val key = EditText(this).apply { hint = "通信密钥(后台渠道配置一致)"; setText(sp.getString("key", "")) }
        status = TextView(this).apply { text = "状态: 未启动"; setPadding(0, pad, 0, pad) }
        box.addView(server); box.addView(key)
        box.addView(Button(this).apply {
            text = "1. 授予通知监听权限"; setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        })
        box.addView(Button(this).apply {
            text = "2. 保存并启动监控"; setOnClickListener {
                sp.edit().putString("server", server.text.toString().trim().replace("/+$".toRegex(), ""))
                    .putString("key", key.text.toString().trim()).apply()
                VmqListener.server = server.text.toString().trim().replace("/+$".toRegex(), "")
                VmqListener.key = key.text.toString().trim()
                VmqListener.running = false
                startService(Intent(this@MainActivity, VmqListener::class.java))
                status.text = "状态: 已启动(保持本App后台存活, 关闭电池优化)"
            }
        })
        box.addView(Button(this).apply {
            text = "3. 检查心跳与权限"; setOnClickListener {
                val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")?.contains(packageName) == true
                status.text = if (enabled) "通知监听权限: 已授予\n服务器: ${VmqListener.server}\n监控中: ${VmqListener.running}" else "请先完成第1步授权"
            }
        })
        box.addView(status)
        setContentView(box)
        VmqListener.server = sp.getString("server", "") ?: ""
        VmqListener.key = sp.getString("key", "") ?: ""
    }
}
