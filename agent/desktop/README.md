# Epay Pages 跨平台监控端

| 平台 | 方案 | 说明 |
|---|---|---|
| 安卓 | `agent/android`(Kotlin源码) | 推送后由 GitHub Actions 自动打包 APK(仓库 Actions 页下载 vmq-agent-apk)；监听支付宝/微信/QQ 通知 |
| Windows | `vmq_agent.py --source notify` | 轮询系统通知数据库 wpndatabase.db，需本机登录微信/支付宝/QQ桌面端并允许通知 |
| macOS | `vmq_agent.py --source notify` | 轮询通知中心 sqlite，需给终端"完全磁盘访问"权限 |
| Linux | `vmq_agent.py --source notify` | dbus-monitor 系统通知 |
| 全平台 | `--source bill` | 支付宝网页账单轮询(需 --cookie --bill-url)，无需任何通知权限 |
| iOS | 不支持后台监听 | 系统限制；请用后台 alipaybill 免CK渠道(服务器端轮询，无需任何设备) |
| QQ | QQ端收单走 `/onebot/report` | 跑 NapCat/LLOneBot 等 OneBot协议端，HTTP上报地址填 `{site}/onebot/report?token=后台onebot_token` |

## 运行
```bash
python3 vmq_agent.py --server https://your.site --key 你的通信密钥
```
与后台「支付渠道 → V免签挂机」里的通信密钥保持一致。取单/推送协议为 /app/vmq/task 与 /app/vmq/push。
