import { Hono } from 'hono';
import { Bindings, hashPassword } from '../lib/auth';
import { getConfig, getConfigAll, OrderRow } from '../lib/db';
import { sendMerchantNotifySafe } from '../lib/orderflow';
import { randomHex, now } from '../lib/util';

export const misc = new Hono<{ Bindings: Bindings }>();

// ---------- 初始化 (仅首次可调用) ----------
misc.post('/install', async (c) => {
  const existing = await getConfig(c.env.DB, 'admin_user');
  if (existing) return c.json({ code: -1, msg: '系统已初始化' });
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password || password.length < 8) return c.json({ code: -1, msg: '用户名/密码(≥8位)不能为空' });
  const syskey = randomHex(32);
  const cronToken = randomHex(16);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('admin_user', username),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('admin_pwd', await hashPassword(password)),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('syskey', syskey),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('sitename', 'Epay Pages'),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('reg_open', '1'),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('channel_map', '{}'),
    c.env.DB.prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('cron_token', cronToken),
  ]);
  return c.json({ code: 0, data: { cron_token: cronToken } });
});

// ---------- 通知重试 (外部定时触发) ----------
misc.get('/api/cron', async (c) => {
  const conf = (await getConfig(c.env.DB, 'cron_token')) || '';
  const token = c.req.query('token') || '';
  if (!conf || token !== conf) return c.json({ code: -1, msg: 'token 错误' });
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE status>=1 AND notify_status=0 AND notify_url!=\'\' AND notify_count<5 ORDER BY id DESC LIMIT 20'
  ).all<OrderRow>();
  let ok = 0;
  for (const order of results || []) {
    await sendMerchantNotifySafe(c.env, order);
    ok++;
  }
  // 账单轮询 (支付宝个人码免挂机通道)
  const { pollAllBills } = await import('../lib/billpoll');
  const billMatched = await pollAllBills(c.env);
  return c.json({ code: 0, data: { retried: ok, bill_matched: billMatched, time: now() } });
});

// ---------- 首页 (现代 Fintech 极简轻奢美学重构) ----------
misc.get('/', async (c) => {
  const conf = await getConfigAll(c.env.DB);
  const ts = now() - 86400;
  const [users, ordersToday, moneyToday, ordersAll] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE addtime>=?').bind(ts).first<{ n: number }>(),
    c.env.DB.prepare('SELECT IFNULL(SUM(money),0) s FROM orders WHERE status>=1 AND addtime>=?').bind(ts).first<{ s: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders').first<{ n: number }>(),
  ]);
  const fmt = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const announce = conf.announcement || '';
  const sitename = conf.sitename || 'Epay Pages';

  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${sitename} - 极简聚合收款平台</title>
<style>
:root{
  --bg:#f8fafc;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --primary:#2563eb;
  --primary-hover:#1d4ed8;
  --primary-light:#eff6ff;
  --accent:#f59e0b;
  --radius:16px;
  --shadow-sm:0 1px 2px rgba(0,0,0,0.04);
  --shadow:0 4px 20px -2px rgba(15,23,42,0.06);
  --shadow-lg:0 20px 30px -6px rgba(15,23,42,0.08);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{text-decoration:none;color:inherit}

/* 导航 */
.nav-wrap{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.nav-box{max-width:1160px;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.nav-brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--text)}
.nav-brand svg{width:28px;height:28px;color:var(--primary)}
.nav-links{display:flex;align-items:center;gap:24px}
.nav-item{font-size:14px;font-weight:500;color:var(--text-muted);transition:color .2s}
.nav-item:hover{color:var(--primary)}
.nav-btn{background:var(--primary);color:#fff;font-size:13px;font-weight:600;padding:8px 18px;border-radius:100px;transition:all .2s;box-shadow:0 2px 8px rgba(37,99,235,0.25)}
.nav-btn:hover{background:var(--primary-hover);transform:translateY(-1px)}

/* 公告 */
.announce-bar{max-width:1160px;margin:80px auto 0;padding:0 20px}
.announce-inner{background:#fffbeb;border:1px solid #fef3c7;color:#92400e;padding:10px 18px;border-radius:100px;font-size:13px;display:flex;align-items:center;gap:8px}

/* Hero */
.hero{padding:${announce ? '24px' : '100px'} 20px 48px;max-width:1160px;margin:0 auto;text-align:center}
.badge-pill{display:inline-flex;align-items:center;gap:6px;background:var(--primary-light);color:var(--primary);font-size:12px;font-weight:600;padding:6px 14px;border-radius:100px;margin-bottom:20px;border:1px solid rgba(37,99,235,0.15)}
.hero h1{font-size:clamp(32px,5vw,52px);font-weight:800;letter-spacing:-1px;color:var(--text);margin-bottom:18px;line-height:1.2}
.hero h1 span{background:linear-gradient(135deg,#2563eb,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:clamp(15px,2vw,18px);color:var(--text-muted);max-width:680px;margin:0 auto 32px}
.hero-btns{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap}
.btn-main{background:var(--text);color:#fff;padding:13px 28px;border-radius:100px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:8px;transition:all .2s;box-shadow:var(--shadow)}
.btn-main:hover{background:#1e293b;transform:translateY(-2px);box-shadow:var(--shadow-lg)}
.btn-sub{background:var(--surface);color:var(--text);border:1px solid var(--border);padding:13px 26px;border-radius:100px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:8px;transition:all .2s}
.btn-sub:hover{border-color:#cbd5e1;background:#f8fafc;transform:translateY(-2px)}

/* 实时数据指标 */
.stats-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);max-width:1040px;margin:0 auto 60px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat-col{text-align:center;padding:10px}
.stat-col:not(:last-child){border-right:1px solid var(--border)}
.stat-val{font-size:26px;font-weight:800;color:var(--text);letter-spacing:-0.5px}
.stat-lbl{font-size:13px;color:var(--text-muted);margin-top:4px}

/* 板块通用 */
.section{max-width:1160px;margin:0 auto 80px;padding:0 20px}
.sec-title{text-align:center;margin-bottom:44px}
.sec-title h2{font-size:28px;font-weight:800;letter-spacing:-0.5px;color:var(--text);margin-bottom:8px}
.sec-title p{font-size:15px;color:var(--text-muted)}

/* 支付渠道 */
.channels-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.channel-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;text-align:center;transition:all .25s ease;box-shadow:var(--shadow-sm)}
.channel-box:hover{transform:translateY(-4px);box-shadow:var(--shadow);border-color:#cbd5e1}
.channel-icon{width:48px;height:48px;border-radius:12px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center}
.channel-name{font-size:16px;font-weight:700;margin-bottom:4px}
.channel-desc{font-size:12px;color:var(--text-muted)}

/* 特性网格 */
.features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.feature-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;transition:all .25s ease;box-shadow:var(--shadow-sm)}
.feature-box:hover{transform:translateY(-4px);box-shadow:var(--shadow);border-color:#cbd5e1}
.feat-icon{width:42px;height:42px;border-radius:10px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.feat-icon svg{width:22px;height:22px}
.feature-box h3{font-size:17px;font-weight:700;margin-bottom:8px;color:var(--text)}
.feature-box p{font-size:13px;color:var(--text-muted);line-height:1.7}

/* 接入流程 */
.steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.step-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;position:relative;box-shadow:var(--shadow-sm)}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--text);color:#fff;font-size:14px;font-weight:700;margin-bottom:16px}
.step-card h3{font-size:16px;font-weight:700;margin-bottom:8px}
.step-card p{font-size:13px;color:var(--text-muted);line-height:1.7}

/* 监控端 */
.dl-card{background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:24px;padding:48px 40px;margin-bottom:60px;box-shadow:var(--shadow-lg)}
.dl-head{margin-bottom:32px}
.dl-head h2{font-size:26px;font-weight:800;margin-bottom:8px}
.dl-head p{font-size:14px;color:#94a3b8}
.dl-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.dl-item{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:22px}
.dl-item h3{font-size:15px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.dl-item p{font-size:12px;color:#94a3b8;line-height:1.7}
.dl-foot{margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94a3b8}
.dl-foot a{color:#38bdf8}

/* 页脚 */
footer{background:var(--surface);border-top:1px solid var(--border);padding:40px 20px;text-align:center;font-size:13px;color:var(--text-muted)}
.footer-links{display:flex;justify-content:center;gap:24px;margin-bottom:12px}
.footer-links a:hover{color:var(--primary)}

/* 响应式 */
@media (max-width:960px){
  .features-grid{grid-template-columns:repeat(2,1fr)}
  .channels-grid{grid-template-columns:repeat(2,1fr)}
  .dl-grid{grid-template-columns:repeat(2,1fr)}
  .stats-card{grid-template-columns:repeat(2,1fr)}
  .stat-col:nth-child(2){border-right:none}
}
@media (max-width:640px){
  .nav-links{display:none}
  .features-grid,.channels-grid,.steps-grid,.dl-grid,.stats-card{grid-template-columns:1fr}
  .stat-col{border-right:none!important;border-bottom:1px solid var(--border)}
  .stat-col:last-child{border-bottom:none}
  .dl-card{padding:32px 20px}
  .dl-foot{flex-direction:column;gap:8px;text-align:center}
}
</style></head><body>

<!-- 导航 -->
<div class="nav-wrap">
  <div class="nav-box">
    <a class="nav-brand" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>${sitename}</span>
    </a>
    <div class="nav-links">
      <a class="nav-item" href="/#channels">支付渠道</a>
      <a class="nav-item" href="/#features">服务优势</a>
      <a class="nav-item" href="/#steps">接入流程</a>
      <a class="nav-item" href="/doc">接入文档</a>
      <a class="nav-item" href="/admin.html">管理后台</a>
    </div>
    <a class="nav-btn" href="/user.html">商户中心</a>
  </div>
</div>

${announce ? `<div class="announce-bar"><div class="announce-inner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg> <b>公告</b>：${announce}</div></div>` : ''}

<!-- Hero 主横幅 -->
<div class="hero">
  <div class="badge-pill">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    <span>新一代轻量聚合免签 · 资金直达</span>
  </div>
  <h1>让每一笔收款 <span>简单直达</span></h1>
  <p>支付宝 / 微信 / QQ / USDT <b>三网聚合</b> · 免签约 · 即时到账 · 免挂机免CK · 秒级回调</p>
  <div class="hero-btns">
    <a class="btn-main" href="/user.html">进入商户中心 →</a>
    <a class="btn-sub" href="/doc">查看接入文档</a>
    <a class="btn-sub" href="/pay/1">码牌收款演示</a>
  </div>
</div>

<!-- 实时数据 -->
<div class="section">
  <div class="stats-card">
    <div class="stat-col"><div class="stat-val">${users?.n || 0}</div><div class="stat-lbl">入驻商户</div></div>
    <div class="stat-col"><div class="stat-val">${ordersToday?.n || 0}</div><div class="stat-lbl">今日订单</div></div>
    <div class="stat-col"><div class="stat-val">¥${fmt(moneyToday?.s || 0)}</div><div class="stat-lbl">今日流水</div></div>
    <div class="stat-col"><div class="stat-val">${ordersAll?.n || 0}</div><div class="stat-lbl">累计处理订单</div></div>
  </div>
</div>

<!-- 支付渠道 -->
<div class="section" id="channels">
  <div class="sec-title">
    <h2>支持的支付方式</h2>
    <p>多渠道聚合分流，资金直接到达您的个人账户</p>
  </div>
  <div class="channels-grid">
    <div class="channel-box">
      <div class="channel-icon" style="background:#eff6ff;color:#2563eb">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>
      </div>
      <div class="channel-name">支付宝</div>
      <div class="channel-desc">当面付 · 官方免CK账单 · 个人码</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#f0fdf4;color:#16a34a">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12c-2.76 0-5 1.79-5 4 0 .7.22 1.36.63 1.93L12 20l2.25-.75c.84.48 1.83.75 2.75.75 2.76 0 5-1.79 5-4s-2.24-4-5-4zM9 4C5.69 4 3 6.24 3 9c0 1.54.83 2.92 2.13 3.86L4.5 16l3.19-1.06c.43.04.87.06 1.31.06 3.31 0 6-2.24 6-5s-2.69-5-6-5z"/></svg>
      </div>
      <div class="channel-name">微信支付</div>
      <div class="channel-desc">扫码 Native · 个人码监听</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#f0f9ff;color:#0284c7">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a9 9 0 0 0-9 9c0 2.2.8 4.2 2.1 5.8L4 21l4.4-1.2A9 9 0 1 0 12 2z"/></svg>
      </div>
      <div class="channel-name">QQ 钱包</div>
      <div class="channel-desc">免挂账单轮询 · OneBot 协议端</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#ecfdf5;color:#059669">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5h-2v-1h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3v-1h-4V7h2V6h2v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3v1h4z"/></svg>
      </div>
      <div class="channel-name">USDT 泰达币</div>
      <div class="channel-desc">TRC20 链上到账 · 零资质限制</div>
    </div>
  </div>
</div>

<!-- 服务优势 -->
<div class="section" id="features">
  <div class="sec-title">
    <h2>比同行更优质的服务</h2>
    <p>全协议覆盖 · 永不掉线 · 拒绝繁琐中转</p>
  </div>
  <div class="features-grid">
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <h3>即时到账零中转</h3>
      <p>资金直接到达您的个人支付宝/微信/QQ钱包或区块链地址，平台不扣留资金、拒绝资金池跑路风险。</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <h3>秒级异步回调</h3>
      <p>到账自动触发商户系统通知与收银台跳转，状态毫秒级流转，高并发事务锁保证回调绝不重复。</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg></div>
      <h3>免挂机 · 免CK</h3>
      <p>首创官方 API 级账单直连模式，开放平台密钥永不过期，彻底告别频繁掉线与登录会话过期烦恼。</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg></div>
      <h3>易支付协议 100% 兼容</h3>
      <p>全面兼容 submit.php、mapi.php、api.php 规范与 MD5/RSA 双重签名算法，市面数千款 CMS 插件开箱即用。</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg></div>
      <h3>智能路由分流</h3>
      <p>支持按支付方式配置多通道加权轮询、最小/最大交易金额过滤，自动熔断异常渠道，业务坚如磐石。</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <h3>风控与分销生态</h3>
      <p>内置 IP 黑名单、全球地区封禁、域名授权白名单、实名制准入、阶梯商户费率与多级邀请分成裂变。</p>
    </div>
  </div>
</div>

<!-- 接入步骤 -->
<div class="section" id="steps">
  <div class="sec-title">
    <h2>十分钟轻松上线</h2>
    <p>简单三步，告别繁冗申请流程</p>
  </div>
  <div class="steps-grid">
    <div class="step-card">
      <div class="step-num">1</div>
      <h3>开通商户凭据</h3>
      <p>进入商户中心注册或由系统管理员为您分配商户号，即可获得专属商户 PID 与 32 位通信签名私钥。</p>
    </div>
    <div class="step-card">
      <div class="step-num">2</div>
      <h3>配置收款通道</h3>
      <p>在后台绑定您的收款码、开放平台密钥或上游通道，可视化点击“添加映射”关联支付方式，无需写代码。</p>
    </div>
    <div class="step-card">
      <div class="step-num">3</div>
      <h3>插件配置或直连</h3>
      <p>在您的网店、发卡站或会员系统后台填入三件套参数，或直接生成码牌链接分享给买家即可完成交易。</p>
    </div>
  </div>
</div>

<!-- 监控端下载 -->
<div class="section">
  <div class="dl-card">
    <div class="dl-head">
      <h2>多端生态 · 监控端下载</h2>
      <p>针对个人码模式，覆盖所有主流平台的监听客户端；QQ与支付宝更支持云端免挂。</p>
    </div>
    <div class="dl-grid">
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
          安卓原生监控 App
        </h3>
        <p>基于最新 Android SDK 原生开发，监听系统通知栏与无障碍到账广播，GitHub Actions 自动云端构建 APK。</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
          Win / Mac / Linux
        </h3>
        <p>Python 跨平台常驻守护端，支持 Windows 消息库抓取、macOS 通知中心、Linux D-Bus 广播与账单轮询双源。</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a9 9 0 0 0-9 9c0 2.2.8 4.2 2.1 5.8L4 21l4.4-1.2A9 9 0 1 0 12 2z"/></svg>
          OneBot 协议端 (QQ)
        </h3>
        <p>无缝支持 NapCat / LLOneBot 机器人框架通过 HTTP 回调直连系统，服务器端监听 QQ 钱包到账，彻底免手机挂机。</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          免CK 云端轮询
        </h3>
        <p>针对支付宝与 QQ 钱包，直接采用服务器云端定时任务轮询对账，手机无需安装任何 App，全自动化确认。</p>
      </div>
    </div>
    <div class="dl-foot">
      <span>开源透明 · 杜绝一切恶意后门与后门注入</span>
      <a href="https://github.com/hackerxiaow/epay-pages" target="_blank">查看 GitHub 源码仓库 →</a>
    </div>
  </div>
</div>

<footer>
  <div class="footer-links">
    <a href="/doc">接入文档</a>
    <a href="/user.html">商户中心</a>
    <a href="/admin.html">管理后台</a>
    <a href="/pay/1">码牌收款</a>
  </div>
  <p>© ${sitename} · 基于 Cloudflare Pages + D1 构建的新一代去中心化收款网关</p>
</footer>

</body></html>`
  );
});
