# Epay Pages

彩虹易支付协议兼容的支付网关，基于 **Cloudflare Pages + D1** 的 TypeScript 全量重写版。
原版（maajiko/Epay 流出的彩虹易支付）在 `vendor/composer` 中存在可泄露 syskey 根密钥的后门
（issue #21，请求头 `PHP-Version: 70200` 触发），且代码底子不适合托管资金 —— 本项目按其
商户接入协议重写，天然免疫该类 PHP 后门。

## 特性

- **协议 100% 兼容**：`submit.php` / `mapi.php` / `api.php` 与彩虹易支付签名规则一致
  （参数 ASCII 升序排除 sign/sign_type/空值，`k=v&...` 拼接后 + 商户密钥取 MD5），
  现有易支付生态商户插件可无缝接入
- **即时到账**：支付成功瞬间商户余额自动入账并记流水；提现走结算申请 + 管理员审核
- **免挂机 / 云端挂机双支持**：
  - 免挂机渠道：`bepusdt`（USDT TRC20）、`xorpay`（聚合）、`epay`（易支付上游）
  - 挂机渠道：`vmq`（V免签协议兼容，挂机端 App 可跑在云手机/任意能联网的设备）
- **安全重构**：D1 参数化查询、会话 HMAC-SHA256 Cookie（不可伪造）、登录限速、
  退款密钥派生仍兼容原版但根密钥只存 D1 不进任何响应
- **原版风格 UI**：管理后台 / 商户中心 / 收银台均沿用彩虹易支付的 Bootstrap3 + WeUI 视觉

## 渠道插件

| 插件 | 说明 | 挂机 | 本地 e2e |
|---|---|---|---|
| `epay` | 易支付上游对接 | 免挂机 | ✅ 全流程 |
| `vmq` | V免签挂机协议（/app/vmq/task、/app/vmq/push） | 需挂机端 | ✅ 全流程 |
| `bepusdt` | BEpusdt USDT 收款 | 免挂机 | 线上联调 |
| `xorpay` | XorPay 聚合（支付宝/微信） | 免挂机 | 线上联调 |

## 部署

```bash
npm i
node scripts/build.mjs          # esbuild -> dist/_worker.js + _routes.json
npx wrangler d1 create epay-db  # 首次，写回 wrangler.toml
npx wrangler d1 execute epay-db --remote --file=schema.sql
npx wrangler pages deploy dist --project-name epay-pages --branch main
```

首次访问 `POST /install` 初始化管理员（仅未初始化时可调用），随后在管理后台配置
「类型→渠道映射」（如 `{"alipay":1,"wxpay":1,"usdt":2}`）即可收款。

商户异步通知重试：外部定时器拨 `GET /api/cron?token=<cron_token>`（安装时生成，可在后台改）。

## 本地测试

```bash
npm test    # wrangler pages dev + mock 上游易支付 + mock 商户端，55 项断言全流程闭环
```

覆盖：安装、登录鉴权与限速、商户/渠道管理、submit/mapi 签名校验（含负例）、
上游回调落账、商户异步/同步回跳验签、回调幂等、余额即时入账、VMQ 取单/推单/金额校验、
syskey 查询/退款兼容、结算审核、开放注册、cron 重试、静态资源。

## 目录

```
src/
  index.ts          # 入口，插件注册与路由装配
  lib/              # sign(MD5协议) / auth(HMAC会话) / db(D1+落账) / orderflow(商户通知)
  lib/plugins/      # epay / vmq / bepusdt / xorpay
  routes/           # proto(协议面) / channel(上游回调+VMQ) / admin / user / misc
public/             # 原版风格静态页 + 原版 vendor 资源
schema.sql          # D1 表结构（金额一律存分）
test/e2e.mjs        # 全流程 e2e
```
