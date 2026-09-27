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

// ---------- 首页 (仿码支付平台内容结构, 保留自有视觉) ----------
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
  const payTypes = [
    ['支付宝', '#1678ff', '当面付 / 个人码 / 账单轮询 / 免CK'],
    ['微信', '#1aad19', '扫码 Native / 个人码监控'],
    ['QQ', '#12b7f5', 'QQ钱包个人码监控'],
    ['USDT', '#26a17b', 'TRC20 链上秒到'],
  ];
  const feats = [
    ['fa-bolt', '秒级自动回调', '到账即确认，订单状态、商户余额实时更新，收银台自动跳转'],
    ['fa-mobile', '多端监控', '安卓原生App / Windows / macOS / Linux 挂机端 / 二开版协议全兼容'],
    ['fa-cloud', '免挂机·免CK', '服务器云端轮询账单，可选开放平台官方API密钥，永不掉线'],
    ['fa-code', '易支付协议100%兼容', 'submit/mapi/api.php 签名规则一致，市面易支付插件无缝接入，支持RSA'],
    ['fa-random', '多渠道聚合路由', '渠道池加权轮询、金额区间分流、自动故障切换'],
    ['fa-shield', '风控与商户体系', 'IP黑名单/地区拦截/域名白名单/实名审核/分组费率/邀请返利'],
  ];
  const steps = [
    ['1', '注册商户', '商户中心注册或管理员创建，获得 PID 与商户密钥'],
    ['2', '配置渠道', '后台添加收款渠道（个人码/官方/上游），设置类型→渠道映射'],
    ['3', '开始收款', '易支付插件填入网关+PID+密钥，或直接用码牌收款页收款'],
  ];
  const stat = (n: string, label: string) =>
    `<div class="stat"><div class="stat-n">${n}</div><div class="stat-l">${label}</div></div>`;
  return c.html(
    `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sitename} - 个人免签聚合收款系统</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","Microsoft YaHei",sans-serif;background:#f5f6f7;color:#333}
.hero{background:linear-gradient(135deg,#4a89dc,#5d9cec);color:#fff;padding:64px 20px 48px;text-align:center}
.hero h1{margin:0 0 12px;font-size:34px;font-weight:800;letter-spacing:1px}
.hero p.slogan{margin:0 0 8px;opacity:.95;font-size:16px}
.hero p.sub{margin:0 0 28px;opacity:.75;font-size:13px}
.btn{display:inline-block;padding:12px 34px;border-radius:6px;text-decoration:none;font-size:15px;margin:0 8px}
.btn-light{background:#fff;color:#4a89dc;font-weight:700}
.btn-ghost{border:1px solid rgba(255,255,255,.7);color:#fff}
.announce{max-width:960px;margin:-22px auto 0;padding:0 16px}
.announce .bar{background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;padding:12px 18px;font-size:13px;color:#8a6d3b;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.stats{max-width:960px;margin:24px auto;padding:0 16px;display:flex;gap:14px;flex-wrap:wrap}
.stat{flex:1;min-width:150px;background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.06)}
.stat-n{font-size:24px;font-weight:800;color:#4a89dc}
.stat-l{font-size:12px;color:#999;margin-top:4px}
.sec{max-width:960px;margin:40px auto;padding:0 16px}
.sec h2{text-align:center;font-size:22px;margin:0 0 6px}
.sec .desc{text-align:center;color:#999;font-size:13px;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.card{background:#fff;border-radius:10px;padding:22px;box-shadow:0 1px 6px rgba(0,0,0,.05)}
.card h3{margin:0 0 8px;font-size:15px;color:#4a89dc}
.card p{margin:0;color:#777;font-size:13px;line-height:1.8}
.pays{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.pay{background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.05)}
.pay .name{font-size:18px;font-weight:800;margin-bottom:6px}
.pay .way{font-size:12px;color:#999}
.flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.step{background:#fff;border-radius:10px;padding:22px;box-shadow:0 1px 6px rgba(0,0,0,.05)}
.step .no{display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#4a89dc;color:#fff;font-weight:700;margin-bottom:10px}
.step h3{margin:0 0 6px;font-size:15px}
.step p{margin:0;color:#777;font-size:13px;line-height:1.7}
.down{background:linear-gradient(135deg,#3b6fc9,#4a89dc);border-radius:12px;color:#fff;padding:28px;margin-top:8px}
.down h2{color:#fff;text-align:left;margin:0 0 6px}
.down .desc{color:rgba(255,255,255,.8);text-align:left;margin:0 0 18px}
.down a{color:#fff}
.dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.dl .item{background:rgba(255,255,255,.12);border-radius:8px;padding:16px}
.dl .item h3{margin:0 0 6px;font-size:14px}
.dl .item p{margin:0;font-size:12px;color:rgba(255,255,255,.85);line-height:1.7}
footer{text-align:center;color:#aaa;font-size:12px;padding:34px}
footer a{color:#888;margin:0 10px;text-decoration:none}
</style></head><body>
<div class="hero">
  <h1>${sitename}</h1>
  <p class="slogan">微信 · 支付宝 · QQ · USDT 三网收款｜免输金额秒回调｜免挂机 · 免CK</p>
  <p class="sub">个人免签聚合收款 · 易支付协议 100% 兼容 · Cloudflare 全球边缘网络</p>
  <a class="btn btn-light" href="/user.html">商户中心</a>
  <a class="btn btn-ghost" href="/doc">接入文档</a>
  <a class="btn btn-ghost" href="/admin.html">管理后台</a>
</div>
${announce ? `<div class="announce"><div class="bar"><i class="fa fa-bullhorn"></i> 公告：${announce}</div></div>` : ''}
<div class="stats">
  ${stat(String(users?.n || 0), '入驻商户')}
  ${stat(String(ordersToday?.n || 0), '今日订单')}
  ${stat('¥' + fmt(moneyToday?.s || 0), '今日收款')}
  ${stat(String(ordersAll?.n || 0), '累计订单')}
</div>
<div class="sec">
  <h2>支持的支付方式</h2>
  <p class="desc">多通道聚合，资金直进您的账户</p>
  <div class="pays">
    ${payTypes.map((t) => `<div class="pay"><div class="name" style="color:${t[1]}">${t[0]}</div><div class="way">${t[2]}</div></div>`).join('')}
  </div>
</div>
<div class="sec">
  <h2>系统特性</h2>
  <p class="desc">为什么选择 ${sitename}</p>
  <div class="grid">
    ${feats.map((f) => `<div class="card"><h3><i class="fa ${f[0]}"></i> ${f[1]}</h3><p>${f[2]}</p></div>`).join('')}
  </div>
</div>
<div class="sec">
  <h2>三步接入</h2>
  <p class="desc">十分钟开始收款</p>
  <div class="flow">
    ${steps.map((s) => `<div class="step"><span class="no">${s[0]}</span><h3>${s[1]}</h3><p>${s[2]}</p></div>`).join('')}
  </div>
</div>
<div class="sec">
  <div class="down">
    <h2>监控端下载</h2>
    <p class="desc">手机/电脑收到账提醒，自动回传确认订单（个人码监控需要至少一个在线端）</p>
    <div class="dl">
      <div class="item"><h3>安卓监控 App</h3><p>原生 Notification 监听，支持支付宝/微信/QQ到账。GitHub 仓库 agent/android 获取源码或 Actions 产物 APK。</p></div>
      <div class="item"><h3>Windows / macOS / Linux</h3><p>Python 跨平台挂机端（agent/desktop），通知中心/账单轮询双源，python3 一条命令运行。</p></div>
      <div class="item"><h3>iOS</h3><p>系统限制无法后台监听通知，推荐直接使用免CK账单轮询渠道（无需任何端）。</p></div>
      <div class="item"><h3>二开版协议</h3><p>兼容市面 V免签二开版 App 与监控端（type: 1微信 2支付宝 3QQ 4USDT）。</p></div>
    </div>
    <p style="margin:14px 0 0;font-size:12px;color:rgba(255,255,255,.75)">源码仓库：<a href="https://github.com/hackerxiaow/epay-pages">github.com/hackerxiaow/epay-pages</a></p>
  </div>
</div>
<footer><a href="/doc">接入文档</a><a href="/user.html">商户中心</a><a href="/admin.html">管理后台</a><a href="/pay/1">码牌演示</a><br/>${sitename} · Powered by Cloudflare Pages + D1</footer></body></html>`
  );
});
