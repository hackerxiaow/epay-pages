package com.epay.vmqagent

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * 通知监听 + 轮询取单 + 推送确认
 * 协议: GET /app/vmq/task?key=&type=  -> {code:1, trade_no, price}
 *       GET /app/vmq/push?key=&trade_no=&price=  -> success
 * 支持包名: 支付宝/微信/QQ(含QQ钱包)
 */
class VmqListener : NotificationListenerService() {
    companion object {
        @Volatile var running = false
        @Volatile var server = ""
        @Volatile var key = ""
        // type -> 当前待支付订单 (trade_no to price元)
        val pending = ConcurrentHashMap<String, Pair<String, Double>>()
        private val PKG_TYPE = mapOf(
            "com.eg.android.AlipayGphone" to "alipay",
            "com.tencent.mm" to "wxpay",
            "com.tencent.mobileqq" to "qqpay"
        )
        private val AMOUNT_RE = Regex("""(?:[¥￥]\s*|(\d+(?:\.\d{1,2})?)\s*元)([0-9]+(?:\.[0-9]{1,2})?)?""")
        private val AMOUNT_RE2 = Regex("""([0-9]+(?:\.[0-9]{1,2})?)\s*元""")
        private val AMOUNT_RE3 = Regex("""[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)""")
    }

    override fun onListenerConnected() { startPolling() }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!running || sbn.notification == null) return
        val type = PKG_TYPE[sbn.packageName] ?: return
        val n = sbn.notification
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val big = n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val raw = "$title $text $big"
        if (!raw.contains("转账") && !raw.contains("收款") && !raw.contains("到账") && !raw.contains("红包")) return
        val amount = AMOUNT_RE2.find(raw)?.groupValues?.get(1)?.toDoubleOrNull()
            ?: AMOUNT_RE3.find(raw)?.groupValues?.get(1)?.toDoubleOrNull() ?: return
        val cur = pending[type] ?: return
        if (Math.abs(cur.second - amount) < 0.001) {
            Thread {
                val r = Http.get("$server/app/vmq/push?key=$key&trade_no=${cur.first}&price=${cur.second}")
                if (r.contains("success")) pending.remove(type)
            }.start()
        }
    }

    private fun startPolling() {
        if (running) return
        running = true
        val types = listOf("alipay", "wxpay", "qqpay")
        Thread {
            while (running) {
                for (t in types) {
                    try {
                        val r = Http.get("$server/app/vmq/task?key=$key&type=$t")
                        if (r.isNotEmpty()) {
                            val j = JSONObject(r)
                            if (j.optInt("code") == 1) {
                                pending[t] = Pair(j.getString("trade_no"), j.getDouble("price"))
                            } else pending.remove(t)
                        }
                    } catch (_: Exception) {}
                }
                try { Thread.sleep(1200) } catch (_: InterruptedException) { return@Thread }
            }
        }.start()
    }
}
