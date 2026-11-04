# 部署到 EdgeOne（Makers / Pages + Blob）

这是 Epay Pages 的 **EdgeOne 版**：同一套业务代码（协议、路由、页面、渠道插件、签名算法全部不动），
数据层从 Cloudflare D1 换成 **EdgeOne Blob 对象存储**，运行时从 Workers 换成 **EdgeOne Node.js 云函数**。

- Cloudflare 分支：`main`（Workers + D1）
- EdgeOne 分支：`edgeone`（Node 云函数 + Blob）
- 两个分支的业务行为由同一份 `test/e2e.mjs`（168 条断言）验证

---

## 一、为什么不是「换个配置文件」的事

| Cloudflare | EdgeOne | 本分支怎么处理 |
| --- | --- | --- |
| Worker `fetch(req, env, ctx)` | 云函数 `onRequest(context)` | `src/edgeone-entry.ts` 适配，垫出 `env` / `waitUntil` |
| D1（SQLite，有事务、有 SQL） | **没有托管数据库** | 数据层改成 Blob 上的 JSON 文档，见 `src/lib/repo.ts` |
| `assets` 绑定 + `env.ASSETS.fetch` | 静态文件由平台直接分发，**优先于函数** | 去掉 ASSETS 回退；HTML 缓存头改由 `edgeone.json` 下发 |
| `triggers.crons`（分钟级） | `edgeone.json` 的 `schedules`（免费版最小 1 天） | 平台调度 + 收银台轮询兜底，见第五节 |
| `cf-connecting-ip` / `request.cf.country` | `context.clientIp` / `context.geo` | 入口转成请求头，业务层只认 `src/lib/net.ts` |
| `wrangler pages deploy` | `edgeone makers deploy` | 见第四节 |

**为什么不用 EdgeOne KV**：KV 只在 Edge Functions（V8）里可用，且是最终一致，没有强一致读。
这套系统有两处必须「写后立刻读到」：

1. 支付回调把订单标记为已支付 → 买家收银台每 2 秒轮询一次，读到旧值就会一直显示「等待支付」
2. 唯一尾数金额占位 → 读到旧值会串单（两笔订单拿到同一个尾数）

Blob 提供两个刚好对上的能力：

- `get(key, { consistency: 'strong' })` —— 绕过 CDN 直读主存储
- `set(key, { onlyIfNew: true })` —— 条件写，失败抛 `PRECONDITION_FAILED`，等价于主键冲突/分布式锁

---

## 二、存储接入方式

### 2.1 依赖与凭据

```bash
npm i @edgeone/pages-blob     # 已在 package.json 里，版本 ^0.0.17
```

函数内部**不需要任何密钥**：`getStore('epay')` 在 Pages Functions 里由平台自动注入临时凭据
（`createUploadUrl` / 外部访问才需要 projectId + token）。

Store 名字是 `epay`，首次写入自动创建，不需要提前建表、建库、跑 SQL。

### 2.2 键空间（表 → key 前缀）

| 原 D1 表 | Blob key | 说明 |
| --- | --- | --- |
| `config` | `cfg` | 全站配置 `{k: v}`，一次读全量，进程内缓存 3s |
| `users` | `u/<uid>`、`un/<username>`、`uctr` | 用户名索引做唯一性条件写 |
| `channels` | `ch/<id>`、`chctr` | 渠道少，直接列前缀 |
| `groups` | `g/<id>`、`gctr` | 初始化时必须 seed `g/1`（默认分组） |
| `orders` | `o/<trade_no>`、`oi/<id>`、`oapi/<api_trade_no>` | `o/` 是订单全文，支付逻辑的唯一真相源 |
| `orders`（列表/统计） | `oidx/<YYYYMMDD>` | **按天**存订单摘要数组；列表、导出、按 IP 统计都扫它 |
| `orders`（待支付） | `pend` | 待支付摘要数组，状态一变就移出 |
| `orders`（统计） | `mstat/<YYYY-MM>` | 月度计数：总单量、各状态单量、金额、按天、按商户 |
| `records` | `rc/<uid>/<id>` | 一人一前缀，按 id 倒序取前 N 条 |
| `settles` | `st/<id>`、`stctr` | 同上 |
| `regcodes` | `rg/<name>` | 图形/邮箱验证码，带过期时间 |
| 幂等标记 | `paid/<trade_no>` | 条件写，保证「待支付→已支付」只发生一次 |
| 租约锁 | `lk/<name>` | 条件写抢锁 + token 比对释放 |

订单摘要刻意留了几个冗余字段（`pay_amount` / `pay_sun`）：它们本来在 `orders.ext` 里，
但「按尾数金额匹配待支付单」这条路径每一步都要用，放进摘要后不用回读订单全文。

### 2.3 一致性策略

| 场景 | 手段 |
| --- | --- |
| 支付幂等 | `paid/<trade_no>` 条件写（onlyIfNew），拿不到就直接返回 |
| 状态机校验 | `orderPatch(..., expect)` 在订单锁内二次校验 `status` |
| 余额增减 | 商户级租约锁内读改写；扣款要求余额足够（等价 `WHERE money>=?`） |
| 自增 id | 读计数器 → 条件写占位 → 回写计数器，冲突自动重试 |
| 列表/统计 | 允许秒级延迟（派生数据），但订单详情永远读 `o/<trade_no>` |

**跨 key 不是原子的**。写路径的顺序是「先订单，后派生」：
`o/` → `oidx/` → `pend` → `mstat`。进程在中间挂掉时，订单本身是对的，
列表可能短暂显示旧状态，下一次状态变更会自愈。这一点和 D1 事务不同，是必须接受的取舍。

---

## 三、数据读写路径

### 3.1 下单（`submit.php` / `mapi.php` / 码牌 `/paygo/:uid`）

```
1  cfg（缓存命中，0 次往返）
2  u/<uid>                                          读商户
3  ch/* 或 ch/<id>                                  渠道路由（按 channel_map 加权）
4  octr + oi/<id>                                   分配自增 id（条件写）
5  o/<trade_no>                                     写订单全文
6  oidx/<今天>                                      读改写当天摘要
7  pend                                             读改写待支付队列
8  mstat/<当月>                                     读改写月度计数
```

约 7~8 次 Blob 往返。这一层是商户服务端调用的，可以接受；真正的买家侧是第 3.2 步的读路径。

### 3.2 收银台与轮询

```
GET /cashier/:tradeNo        → o/<trade_no>（1 次）+ ch/<id>（1 次）+ cfg
GET /api/cashier/status      → o/<trade_no>（1 次）
                               waitUntil: pollAllBills（10s 节流）/ pollTronOrder（5s 节流）
```

轮询只读订单全文，不读摘要，因此支付状态永远是最新的。

### 3.3 支付确认（`/channel/notify/*`、`/appPush`、OneBot、账单轮询、链上扫账）

```
1  o/<trade_no>                    读订单
2  paid/<trade_no>                 条件写占位（抢不到 = 已处理过，直接返回）
3  orderPatch(status=1)            订单锁内改状态 → o/ → oidx/ → pend → mstat
4  u/<uid>                         余额入账（商户锁）
5  rc/<uid>/<id>                   记流水
6  （可选）u/<inviter> + rc       邀请返利
7  waitUntil: 商户 notify_url      改 notify_status / notify_count（再各一次 patch）
```

第 2 步是关键：它替代了 D1 的 `UPDATE ... WHERE status=0` 受影响行数判断，
并发回调、重复回调、超时重试都只会入账一次（e2e 里有「重复回调幂等」断言）。

### 3.4 列表 / 统计

| 接口 | 数据来源 |
| --- | --- |
| `/admin/api/orders` | `oidx/*` 按天倒序扫描；无关键词时总数直接取 `mstat` 各状态计数 |
| `/admin/api/export` | 同上，取近 N 天最多 5000 条 |
| `/admin/api/info` | `mstat`（今日单量/金额、待支付）+ 用户前缀计数 |
| `/admin/api/trend` | `mstat` 的按天计数，最近 7 天 |
| `/admin/api/buyerstat` | 扫 `oidx/*` 里已支付订单，按 IP 聚合 |
| `/api/stats`、首页 | `statWindow(now-86400)` 扫最近两天日桶（保持原「滚动 24 小时」口径） |
| `/user/api/orders` | `oidx/*` 过滤 uid；总数取 `mstat` 的 `users[uid]` |
| `/user/api/records` | `rc/<uid>/*` 前缀倒序取 50 |
| `/admin/api/settles` | `st/*` 前缀倒序取 100 + 批量补商户名 |

---

## 四、部署流程

部署有两条路，**推荐第 1 条（连 GitHub，推代码即上线）**。

### 4.1 连接 GitHub 自动部署（推荐）

在 EdgeOne 控制台「创建项目 → 导入 Git 仓库」里选 `hackerxiaow/epay-pages`，然后按下表填：

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| 分支 | **`edgeone`** | ⚠️ 不要选 `main`：那是 Cloudflare 版，产物是 `_worker.js`，在 EdgeOne 上跑不起来 |
| 框架预设 | 无 / Other | 不要选 Next/Nuxt 之类的预设 |
| 根目录 | `/`（默认） | |
| 安装命令 | `npm install --include=dev` | 已写进 `edgeone.json`；显式带上 devDependencies，防止平台以 `NODE_ENV=production` 跑时跳过 esbuild |
| 构建命令 | `npm run eo:build` | 已写进 `edgeone.json` 的 `buildCommand` |
| 输出目录 | `dist` | 已写进 `edgeone.json` 的 `outputDirectory` |
| Node 版本 | `20.18.0` | 平台预装版本之一，与 `edgeone.json` 的 `nodeVersion` 一致 |

`edgeone.json` 里的 `buildCommand / installCommand / outputDirectory / nodeVersion` 会覆盖控制台配置，
所以即使控制台留空，构建也会按仓库里的配置跑。构建过程做两件事：
把 `public/` 复制成 `dist/`，把 `src/edgeone-entry.ts` 打成 `cloud-functions/[[default]].js`。
平台会同时收走 `dist/`（静态站）和仓库根的 `cloud-functions/`（云函数），
**不需要把 `cloud-functions/` 提交进仓库**（已在 `.gitignore` 里）。

环境变量（控制台的「项目设置 → 环境变量」）：

| 变量 | 必填 | 作用 |
| --- | --- | --- |
| `CRON_TOKEN` | 可选 | 配了之后 `/api/cron/tick?token=` 必须带同一个值；不配则按 5 分钟一次限流放行 |
| `ADMIN_SECRET` | 可选 | 覆盖会话签名密钥 |
| `SITE_NAME` | 可选 | 展示用站点名 |
| `EPAY_BLOB_PROJECT_ID` | 兜底 | 形如 `makers-xxxxxxxx`，仅在 Blob 凭据没被平台注入时需要 |
| `EPAY_BLOB_TOKEN` | 兜底 | EdgeOne API Token，与上一项配对使用 |

**不要配 `EPAY_STORE`**：默认就是 `edgeone`（只用 Blob，拿不到直接报错，避免静默退化成内存）。

首次部署完成后，浏览器或 curl 访问一次 `POST /install` 建管理员与默认分组（见 4.3），
之后每次 push 到 `edgeone` 都会自动重新构建并上线。**Blob 里的数据不会因为重新部署而丢**，
所以日常改代码不需要重新初始化，也不会清空订单。

> 构建产物里没有 `_routes.json` / `_worker.js`，也不跑 `wrangler`：
> 这个分支把 `wrangler` 依赖去掉了（干净安装 10 个包、约 4 秒），构建只依赖 esbuild。

### 4.2 命令行部署（不用 GitHub 时）

#### 1. 装依赖 + 本地验证

```bash
npm i
npm run typecheck        # 0 error 才算过
npm test                 # = EPAY_SERVER=eo node test/e2e.mjs，168 条断言
```

`npm test` 会先跑 `eo-build`，再用 `scripts/eo-local.mjs` 起一个「静态优先 + 内存存储」的服务，
完整跑一遍安装/登录/下单/回调/退款/结算/账单轮询/链上查账，**全绿才继续**。

本地手动看界面：

```bash
npm run dev              # http://localhost:8787，数据在内存里
curl -X POST localhost:8787/install -H 'content-type: application/json' \
     -d '{"username":"admin","password":"admin12345"}'
```

#### 2. 构建

```bash
npm run eo:build
```

产物：

```
dist/                           静态站（admin.html / user.html / assets / paypage）
cloud-functions/[[default]].js  函数包（约 185 KB，含 Blob SDK）
cloud-functions/index.js        `/` 的入口（[[default]] 不匹配根路径）
```

#### 3. 生成路由表（**必做，漏了全站 404**）

```bash
npx edgeone makers generate-routes
```

`eo:build` 只产代码不产路由。正确生成后 `.edgeone/routes.json` 应是：

```json
[
  { "src": "^/(.*)$", "handle": "filesystem" },                  // 先找静态文件
  { "src": "^/$",     "dest": "cloud-functions/api-node" },      // 再进函数
  { "src": "^/(.*)$", "dest": "cloud-functions/api-node" }
]
```

顺序错了会表现为「静态资源 200，首页/接口/后台全 404」。

#### 4. 部署

```bash
npx edgeone login                 # 或跳过，直接带 token
npx edgeone makers deploy \
  -n epay-pages \
  -t "$EDGEONE_TOKEN" \
  -a overseas \
  --json \
  --skip-ai-gateway-sync
```

或一条命令（`eo:deploy` 已串好 build → generate-routes → deploy）：

```bash
npm run eo:deploy -- -n epay-pages -t "$EDGEONE_TOKEN" -a overseas --skip-ai-gateway-sync
```

- `-n` 项目名，首次部署自动创建，同名即更新
- `-a overseas` 海外站（大陆站需要已备案域名）
- 部署会清理 `.edgeone/`；上一次中断残留会报 `safe-delete broker denied delete`，
  先 `rm -rf .edgeone` 再重跑

### 4.3 部署后自检（先看这一条，比猜 500 快）

```bash
curl https://<你的域名>/api/health
```

正常返回：

```json
{ "ok": true, "store": "edgeone", "initialized": false, "time": 1730000000 }
```

三种异常：

| 返回 | 含义 | 处理 |
| --- | --- | --- |
| `503` + `Missing: deployCredential` | 平台没把 Blob 凭据注入到函数里 | 见 4.3.1 |
| `503` + 其它 error | 有凭据但调不通（配额、网络、store 名） | 把 error 贴出来 |
| `404` | 请求没进函数（被当静态资源了） | 见 4.5 |

`initialized: false` 表示还没跑 `/install`。

#### 4.3.1 Blob 凭据没注入怎么办

SDK 的凭据有两条来源：平台在部署时替换函数包里的 `{{PAGES_BLOB_DEPLOY_CREDENTIAL}}` 占位符，
或运行时读环境变量 `PAGES_BLOB_DEPLOY_CREDENTIAL`。两条都没有时会报 `Missing: deployCredential`。

按顺序排查：

1. **控制台确认项目已启用 Blob / 对象存储**（免费版有 1 GB 额度，但需要项目开启这个能力）。
2. **确认函数真的跑在 Node 云函数环境**：构建日志里应能看到 `cloud-functions/[[default]].js`；
   请求 `/` 返回 503 说明函数在跑、只是存储没准备好；返回 404 则是另一个问题（见 4.5）。
3. **显式凭据兜底**：在项目环境变量里加

   | 变量 | 取值 |
   | --- | --- |
   | `EPAY_BLOB_PROJECT_ID` | 项目 ID，控制台项目设置里能看到，形如 `makers-xxxxxxxx` |
   | `EPAY_BLOB_TOKEN` | EdgeOne API Token（控制台「API Token」页面生成） |

   我们的 `blob-store.ts` 在检测到 `MISSING_ENVIRONMENT` 时会自动改用
   `getStore({ name: 'epay', projectId, token })`，不需要改代码，重新部署即可。

### 4.4 初始化（部署后第一件事，两种方式都要做）

```bash
curl -X POST https://<你的域名>/install \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"你的密码"}'
```

返回 `{ code: 0, data: { cron_token } }`，记下 `cron_token`（后台通知重试用的那个，与 `CRON_TOKEN` 无关）。
初始化会同时写入：管理员、`syskey`、站点名、注册开关、渠道映射、`cron_token`，以及**默认分组 `g/1`**
（原 `migrate-v2.sql` 的职责，漏了会让后台新建的分组抢占 id=1，把所有商户套上错误费率）。
重复调用会返回「系统已初始化」，不会覆盖数据。

### 4.5 定时任务

`edgeone.json` 默认一条：

```json
{"name":"epay-cron","cron":"0 3 * * *","path":"/api/cron/tick?token=change-me","method":"GET","timezone":"Asia/Shanghai"}
```

`token=change-me` 是**故意留在仓库里的占位值**：`edgeone.json` 要提交进 Git，
把真口令写进去等于把密钥推上 GitHub。所以 `/api/cron/tick` 的口令是可选的：

- 控制台配了 `CRON_TOKEN` → 必须与 URL 里的 `token` 一致，否则 403（此时需要你自行把 URL 改成真值，
  或者把 `CRON_TOKEN` 留空）
- 没配 `CRON_TOKEN` → 放行，但用 Blob 记时间戳**限流成 5 分钟一次**（返回 429 表示被限流）

免费版 cron **最小间隔是 1 天**，所以真正的分钟级靠两条兜底：

- 买家开着收银台时，`/api/cashier/status` 每 2 秒触发一次账单轮询（10 秒节流）与链上查账（5 秒节流）
- 商户/后台的任意请求都会顺带读到最新数据

没有流量时也就没有待确认的订单，每天一次的兜底足够重试失败回调。

---

## 五、改动清单

### 新增

| 文件 | 作用 |
| --- | --- |
| `src/lib/blob-store.ts` | Blob 原语（读/写/删/list + `onlyIfNew` + 强一致），内存实现供本地跑 |
| `src/lib/repo.ts` | 数据层：8 张表的文档模型、索引、锁、统计聚合（约 1080 行） |
| `src/lib/net.ts` | `clientIp()` / `clientCountry()`，抹平 CF 与 EdgeOne 的取法差异 |
| `src/lib/cron.ts` | 通知重试 + 账单轮询 + 链上扫账，供两个入口复用 |
| `src/edgeone-entry.ts` | 云函数入口：请求物化、平台信息注入、`waitUntil` 垫片、`/api/cron/tick` |
| `scripts/eo-build.mjs` | 构建 dist + cloud-functions |
| `scripts/eo-local.mjs` | 本地/ e2e 用的「静态优先 + 云函数」服务器 |
| `edgeone.json` | 平台配置：输出目录、Node 版本、超时、缓存头、定时任务 |
| `tsconfig.json` | 只做类型检查（`npm run typecheck`），不参与打包 |
| `docs/edgeone-deploy.md` | 本文 |

### 修改

| 文件 | 改动 |
| --- | --- |
| `src/lib/db.ts` | 保留 `getConfig* / setConfig / markOrderPaid / markOrderRefunded` 的语义，底层换成 repo；支付幂等改条件写 |
| `src/lib/auth.ts` | `Bindings` 去掉 `DB`，加 `ADMIN_SECRET/SITE_NAME` |
| `src/lib/routing.ts` | 渠道查询改 `channelByIds()` |
| `src/lib/orderflow.ts` | 回调结果改 `orderBumpNotify()` |
| `src/lib/billpoll.ts` | 账单匹配改待支付队列；`ensurePayAmount` 用摘要里的 `pay_amount` 去重 |
| `src/lib/tronusdt.ts` | 微尾数去重、`ext` 写入、txid 反查、批量扫链全部走 repo |
| `src/lib/plugins/vmq.ts` | 取单/推送走待支付队列 |
| `src/routes/proto.ts` | 下单落库改 `orderCreate()`；IP/国家码改 `clientIp()/clientCountry()` |
| `src/routes/{admin,user,misc,features,channel,vmqcompat,onebot}.ts` | 135 处 SQL → repo 调用（字段集保持不变） |
| `src/index.ts` | 去掉 `ASSETS` 回退（EdgeOne 静态优先），兜底改 404 |
| `test/e2e.mjs` | 支持 `EPAY_SERVER=eo`：改用 `eo-local.mjs` + 内存存储，断言一条没删 |
| `package.json` | 新增 `@edgeone/pages-blob`；加 `eo:*` / `typecheck` 脚本；`test` 改为 EO 模式；**移除 `wrangler` 依赖**（干净安装从 48 个包 / 263 MB 降到 10 个包 / 46 MB，构建 4 秒） |
| `edgeone.json` | 增加 `buildCommand` / `installCommand`，让控制台零配置也能构建；`cloudFunctions` 改为文档要求的 `nodejs.maxDuration` 结构 |
| `README.md` | 补分支说明与 EdgeOne 部署入口 |

### 保留不动（仅作对照）

`wrangler.toml`、`schema.sql`、`migrate-v2.sql`、`scripts/build.mjs`。
这个分支上不跑 wrangler、不用 D1：`npm run dev` 已改为 `node scripts/eo-local.mjs`（本地 EdgeOne 模拟），
`schema.sql` / `migrate-v2.sql` / `wrangler.toml` 只作对照，不参与部署。

---

## 六、兼容性问题与限制

### 必须知道的

1. **没有事务**。跨 key 的写入不是原子的，所有写路径按「幂等 + 条件校验」设计；
   极端情况下（进程在两把锁之间被回收）列表可能短暂显示旧状态，订单详情永远准确。
2. **单值 25 MB、账号总容量 1 GB（免费版）**。订单按天分桶，一天几千单也只有几百 KB；
   月度统计文档一年约 10 KB。真到天花板时按年归档即可。
3. **写请求会多 5~8 次 Blob 往返**（强一致读走主存储）。跨境节点下单实测在数百毫秒量级，
   比 Workers 同进程读 D1 慢，但买家侧轮询只读一个 key，感知不明显。
4. **预置域名 `*.edgeone.dev` 在大陆访问可能 401**，正式用请绑定自己的域名。
5. **`/admin/api/orders` 不再返回 `ext` 字段**（列表走摘要，`ext` 只在订单详情/支付逻辑里用）。
   内置后台不读这个字段；如果你二次开发读过它，改成按 `trade_no` 调 `/api.php?act=order`。
6. **后台关键词搜索是全量扫描**（按天倒序），订单量很大时会变慢；按状态/分页走的是统计计数，不受影响。
7. **D1 存量数据不会自动迁移**。Blob 版是从空库开始；
   要搬历史数据，按 `schema.sql` 的列导出 JSON，再按第二节的键空间写入（或写个一次性导入脚本）。

### 连 GitHub 自动部署的注意点

1. **分支必须选 `edgeone`**。`main` 是 Cloudflare 版：产物是 `dist/_worker.js` + `_routes.json`，
   没有 `cloud-functions/`，在 EdgeOne 上只会变成一堆静态文件 + 全站 404。
2. **数据不随部署丢失**。Blob 里的 key 独立于构建产物，改代码重新部署后订单、商户、配置都还在；
   只有第一次部署需要 `POST /install`。
3. **构建命令读仓库里的 `edgeone.json`**，控制台留空也会按 `npm run eo:build` 跑；
   但控制台如果被手动改过（例如选了 Next.js 预设），会以控制台为准，记得核对。
4. **`cloud-functions/` 不要提交**（已在 `.gitignore`）。平台在构建完成后从工作区读取它；
   如果你本地提交了旧的构建产物，反而可能盖掉新构建的结果。
5. **构建时间**约 10 秒（装依赖 4s + esbuild 2s + 复制静态资源）。构建失败会在控制台看到完整日志，
   最常见原因是 Node 版本被设成了非 20.x。
6. **生产分支要选 `edgeone`**。控制台把「生产」环境绑定到一个分支（默认可能是仓库的默认分支 `main`）。
   如果创建项目时只能选 `main`，两个办法：把仓库默认分支改成 `edgeone`，或者继续用命令行部署（4.2），
   Git 集成只用来出预览环境。
7. **万一部署后全站 404**（静态资源 200、HTML 和接口 404），先分清是哪种 404：
   - 页面标题是 `Tencent Edgeone`（平台 404 页）→ 函数没被登记。看构建日志确认
     `cloud-functions/[[default]].js` 有没有生成；再确认项目根目录设置是 `/`、
     输出目录是 `dist`、函数目录没被改成别的名字。
   - 页面是纯文本 `Not Found` → 函数跑起来了，但路由没匹配（少见，通常是路径大小写问题）。
   注意 `npx edgeone makers generate-routes` **不是**这个场景的解药：它只处理 SSR / Edge Function
   的 `.edgeone/server-handler`，普通 `cloud-functions/` handler 由平台按目录直接映射。

### 容易踩的

- **地区拦截**：EdgeOne 的 `context.geo` 在 Node 函数里叫 `geo`（不是 `request.cf.country`）。
  入口会把它写成 `cf-ipcountry` 头；取不到时按「不拦截」处理（fail-open），
  需要强拦截的场景请用 IP 黑名单。
- **客户端 IP**：优先 `context.clientIp`，其次 `x-forwarded-for`，最后 `x-real-ip`。
  经过自有反代时记得让反代透传 `x-forwarded-for`。
- **静态资源优先**：`/admin.html`、`/user.html` 是静态文件，请求不会进函数，
  所以它们的缓存头只能在 `edgeone.json` 里配，写不到代码里。
- **HTML 缓存**：`edgeone.json` 对两个 HTML 配了 `no-cache`；若新增 HTML 页面，记得同步加规则。
- **重名 key 前缀**：`u/` 和 `un/`、`o/` 和 `oidx/` 都是不同前缀，不会互相污染；
  新增前缀时注意别和 `chctr`、`stctr` 这类「无斜杠」的计数器 key 撞上。
- **锁超时**：租约锁 TTL 15s、等待上限 10s，超时抛错返回 500。
  批量操作（如结算审核循环）不要在一个锁里串太多写。

---

## 七、验收清单

| 项 | 期望 |
| --- | --- |
| `npm run typecheck` | 0 error |
| `npm test`（EdgeOne 模式） | 168 通过 / 0 失败 |
| `npm run eo:build` | 函数包 < 300 KB，dist ≈ 5.5 MB |
| 部署后 `GET /` | 200，首页含「三网聚合」 |
| 部署后 `GET /admin.html` | 200，`Cache-Control: no-cache` |
| `POST /install` | 返回 `cron_token`，重复调用返回「系统已初始化」 |
| 下一单 → 收银台 → 模拟支付 | 订单状态 0 → 1，商户余额增加，回调收到 `success` |
| 重复回调 | 不重复入账 |
| 断开/重启函数实例后再查订单 | 数据仍在（说明写的是 Blob 而不是内存） |
