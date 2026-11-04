# Epay Pages

彩虹易支付协议兼容的支付网关，基于 **Cloudflare Pages + D1** 的 TypeScript 全量重写版。
原版（maajiko/Epay 流出的彩虹易支付）在 `vendor/composer` 中存在可泄露 syskey 根密钥的后门
（issue #21，请求头 `PHP-Version: 70200` 触发），且代码底子不适合托管资金 —— 本项目按其
商户接入协议重写，天然免疫该类 PHP 后门。

> **分支说明**
>
> | 分支 | 运行时 | 数据层 | 部署 |
> | --- | --- | --- | --- |
> | `main` | Cloudflare Workers | D1 | `wrangler pages deploy` |
> | `edgeone`（当前） | EdgeOne Node.js 云函数 | **EdgeOne Blob** | `edgeone makers deploy` |
>
> 两个分支业务代码完全相同（协议、路由、页面、渠道插件、签名算法一行没改），
> 只有数据访问层、入口与构建方式不同。EdgeOne 部署见 **[docs/edgeone-deploy.md](./docs/edgeone-deploy.md)**。
> 这个分支不跑 wrangler、不用 D1：`npm run dev` 已改为本地 EdgeOne 模拟（静态优先 + 内存存储），
> `npm test` 默认跑 EdgeOne 模式。连 GitHub 后推代码即自动构建部署，详见文档第四节。
>
> **两个必须知道的约束**（实测踩出来的）：
> 1. `cloud-functions/` 必须提交进仓库 —— 平台在构建命令**之前**扫描它来登记函数路由，
>    不提交就会「静态资源 200、其余全 404」。仓库里的 pre-commit 钩子会在你改 `src/` 时
>    自动重建这份产物并 stage，不用手动构建。
> 2. 部署成功 ≠ 立即生效，生产域名要 30~120 秒才切过去。部署后先看
>    `GET /api/health`（返回存储类型、初始化状态、构建标识），用它核对线上跑的是哪次提交。
>
> **两个必须知道的约束**（实测踩出来的）：
> 1. `cloud-functions/` 必须提交进仓库 —— 平台在构建命令**之前**扫描它来登记函数路由，
>    不提交就会「静态资源 200、其余全 404」。仓库里的 pre-commit 钩子会在你改 `src/` 时
>    自动重建这份产物并 stage，不用手动构建。
> 2. 部署成功 ≠ 立即生效，生产域名要 30~120 秒才切过去。部署后先看
>    `GET /api/health`（返回存储类型、初始化状态、构建标识），用它核对线上跑的是哪次提交。

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
| `vmq` | V免签协议，**原版安卓App直接兼容**（appHeart/appPush/getState），QQ/USDT 类型支持，监控端全自研 | 需挂机端 | ✅ 全流程 |
| `qqbill` | QQ钱包个人码账单轮询（二开码支付同款：云端Cookie轮询账单，金额尾数匹配） | **免挂机** | ✅ mock 全流程 |
| OneBot | `/onebot/report` 接收 NapCat/LLOneBot QQ协议端上报，QQ钱包到账自动确认 | 免挂机 | ✅ 全流程 |
| `alipayf2f` | 支付宝当面付官方直连（RSA2），支持结算自动打款 | 免挂机 | ✅ mock 全流程 |
| `wxpaynative` | 微信扫码支付官方直连（V2/MD5） | 免挂机 | ✅ mock 全流程 |
| `alipaybill` | 支付宝个人码账单轮询，双数据源：**免CK模式**（开放平台 APPID+RSA2 调官方账单API `accountlog.query`，密钥永不过期）/ Cookie模式，含免输金额转账链接（PID唤起支付宝带金额） | **免挂机** | ✅ mock 全流程 |
| 监控端 | `agent/android` 安卓App(Kotlin, Actions自动打包APK) + `agent/desktop` 跨平台挂机端(Win通知库/mac通知中心/Linux dbus/支付宝账单源) | 挂机端 | — |
| `bepusdt` | BEpusdt USDT 收款 | 免挂机 | 线上联调 |
| `xorpay` | XorPay 聚合（支付宝/微信） | 免挂机 | 线上联调 |

> 个人收款推荐组合：`alipaybill`（免挂机主力）+ `vmq`（云手机挂机兜底）双保险；
> Cookie 失效时轮询拿不到账单，订单保持待支付，可随时切 VMQ。

## 完整功能

- **协议**：submit/mapi/api.php 兼容（MD5 + RSA 双签名，平台自动生成密钥对，通知按商户类型回签）
- **路由**：`channel_map` 支持多渠道加权轮询（`"1,2,3"`），渠道级 paymin/paymax 金额区间
- **资金**：即时到账、退款幂等、结算审核 + 支付宝自动打款、分组费率、邀请返利
- **风控**：IP 黑名单（支持前缀）、CF 国家码地区拦截、商户域名白名单、强制实名、支付用户统计
- **体系**：商户分组、实名认证（人工审核）、图形验证码（内置 SVG 算术）、邮箱验证码（Webhook 投递）、平台公告
- **杂项**：码牌收款页 `/pay/<uid>`、接入文档 `/doc`、订单 CSV 导出、7 日趋势图、通知重试 cron

## 部署

### EdgeOne（本分支）

```bash
npm i
npm test                          # 168 项断言，先本地跑通
npm run eo:build                  # -> dist/ + cloud-functions/
npx edgeone makers generate-routes
npx edgeone makers deploy -n epay-pages -t "$EDGEONE_TOKEN" -a overseas \
  --json --skip-ai-gateway-sync
```

部署后 `POST /install` 初始化（会同时建默认分组），并在项目设置里配置 `CRON_TOKEN`。
完整步骤、存储设计、读写路径与兼容性问题见 **[docs/edgeone-deploy.md](./docs/edgeone-deploy.md)**。

### Cloudflare（main 分支）

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
npm test        # 本分支：eo-local（静态优先 + 内存存储）+ mock 上游易支付 + mock 商户端
```

168 项断言覆盖：协议双签名（MD5/RSA 含负例）、渠道全流程（含支付宝 RSA2 响应验签、
微信 V2 XML 验签、免CK官方账单API、码支付 submit 兼容）、加权轮询、风控、费率/返利、实名、验证码、导出/统计、幂等与回滚。

## 目录

```
src/
  index.ts          # 入口，插件注册与路由装配
  edgeone-entry.ts  # EdgeOne 云函数入口（请求物化 / 平台信息注入 / waitUntil 垫片）
  lib/              # sign(MD5协议) / auth(HMAC会话) / db(落账) / orderflow(商户通知)
  lib/repo.ts       # 数据层：8 张表 → Blob 文档模型
  lib/blob-store.ts # EdgeOne Blob 原语（含内存实现）
  lib/plugins/      # epay / vmq / bepusdt / xorpay
  routes/           # proto(协议面) / channel(上游回调+VMQ) / admin / user / misc
public/             # 原版风格静态页 + 原版 vendor 资源
scripts/            # build.mjs(CF) / eo-build.mjs / eo-local.mjs
edgeone.json        # EdgeOne 项目配置
schema.sql          # D1 表结构（金额一律存分，仅 main 分支使用）
test/e2e.mjs        # 全流程 e2e（两个分支共用）
```
