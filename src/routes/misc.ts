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

// ---------- 首页 (与后台同款 Bootstrap3 导航布局) ----------
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
  const pays = [
    ['支付宝', '#1678ff', '当面付 / 个人码 / 免CK账单'],
    ['微信', '#1aad19', '扫码 Native / 个人码监控'],
    ['QQ', '#12b7f5', 'QQ钱包账单轮询 / OneBot'],
    ['USDT', '#26a17b', 'TRC20 链上秒到'],
  ];
  const feats = [
    ['fa-bolt', '秒级自动回调', '到账即确认，订单状态、商户余额实时更新，收银台自动跳转'],
    ['fa-mobile', '多端监控', '安卓App / Windows / macOS / Linux / OneBot协议端，多端任意组合'],
    ['fa-cloud', '免挂机 · 免CK', '云端轮询账单，可选支付宝开放平台官方API密钥，永不掉线'],
    ['fa-code', '易支付协议兼容', 'submit/mapi/api.php 签名一致，市面易支付插件无缝接入，支持RSA'],
    ['fa-random', '多渠道聚合', '渠道池加权轮询、金额区间分流、故障自动切换'],
    ['fa-shield', '风控与商户体系', 'IP黑名单/地区拦截/域名白名单/实名审核/分组费率/邀请返利'],
  ];
  const steps = [
    ['1', '注册商户', '商户中心注册或管理员创建，获得 PID 与商户密钥'],
    ['2', '配置渠道', '后台添加收款渠道，设置类型→渠道映射'],
    ['3', '开始收款', '易支付插件填网关+PID+密钥，或用码牌收款页收款'],
  ];
  const stat = (n: string, label: string) =>
    `<div class="col-sm-3 col-xs-6"><div class="panel panel-default"><div class="panel-body text-center"><div class="stat-n">${n}</div><div class="text-muted small">${label}</div></div></div></div>`;
  return c.html(
    `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sitename} - 个人免签聚合收款系统</title>
<link href="/assets/css/bootstrap.min.css" rel="stylesheet"/>
<link href="/assets/vendor/font-awesome/css/font-awesome.min.css" rel="stylesheet"/>
<style>
body{padding-top:50px;font-family:"Microsoft YaHei",-apple-system,"Helvetica Neue",sans-serif;background:#f5f6f7}
.navbar-default{background-color:#337ab7;border-color:#2e6da4}
.navbar-default .navbar-brand,.navbar-default .navbar-nav>li>a{color:#fff}
.navbar-default .navbar-nav>.active>a,.navbar-default .navbar-nav>.active>a:focus,.navbar-default .navbar-nav>.active>a:hover{color:#337ab7;background-color:#fff}
.navbar-default .navbar-nav>li>a:focus,.navbar-default .navbar-nav>li>a:hover{color:#dff0ff}
.navbar-default .navbar-toggle .icon-bar{background-color:#fff}
.hero{background:linear-gradient(135deg,#4a89dc,#5d9cec);color:#fff;padding:36px 0 32px;text-align:center}
.hero h1{margin:0 0 8px;font-size:24px;font-weight:700}
.hero p{margin:0 0 16px;opacity:.92;font-size:14px}
.btn-light{background:#fff;color:#337ab7;font-weight:700;border-color:#fff}
.btn-light:hover{background:#f0f6ff}
.btn-ghost{border:1px solid rgba(255,255,255,.7);color:#fff;background:transparent}
.stat-n{font-size:20px;font-weight:700;color:#337ab7}
.sec{padding:26px 0 4px}
.sec h2{font-size:18px;margin:0 0 4px}
.sec .desc{color:#999;font-size:12px;margin:0 0 16px}
.card h3{margin:0 0 8px;font-size:14px;color:#337ab7}
.card p{margin:0;color:#777;font-size:12px;line-height:1.8}
.pay .name{font-size:16px;font-weight:700;margin-bottom:4px}
.pay .way{font-size:11px;color:#999}
.step .no{display:inline-block;width:26px;height:26px;line-height:26px;border-radius:50%;background:#337ab7;color:#fff;font-weight:700;margin-bottom:8px;text-align:center}
.step h3{margin:0 0 6px;font-size:14px}
.step p{margin:0;color:#777;font-size:12px;line-height:1.7}
.down{background:linear-gradient(135deg,#3b6fc9,#4a89dc);border-radius:8px;color:#fff;padding:20px}
.down h2{color:#fff;font-size:18px;margin:0 0 4px}
.down .desc{color:rgba(255,255,255,.85);font-size:12px;margin:0 0 14px}
.down .item h3{margin:0 0 4px;font-size:13px}
.down .item p{margin:0;font-size:12px;color:rgba(255,255,255,.85);line-height:1.7}
footer{text-align:center;color:#aaa;font-size:12px;padding:26px}
footer a{color:#888;margin:0 8px;text-decoration:none}
</style></head><body>
<nav class="navbar navbar-fixed-top navbar-default">
  <div class="container">
    <div class="navbar-header">
      <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar">
        <span class="icon-bar"></span><span class="icon-bar"></span><span class="icon-bar"></span>
      </button>
      <a class="navbar-brand" href="/"><i class="fa fa-shield"></i> ${sitename}</a>
    </div>
    <div id="navbar" class="collapse navbar-collapse">
      <ul class="nav navbar-nav">
        <li><a href="/#pays">支付方式</a></li>
        <li><a href="/#feats">系统特性</a></li>
        <li><a href="/doc">接入文档</a></li>
        <li><a href="/admin.html">管理后台</a></li>
      </ul>
      <ul class="nav navbar-nav navbar-right">
        <li><a href="/user.html"><i class="fa fa-user"></i> 商户中心</a></li>
      </ul>
    </div>
  </div>
</nav>
<div class="hero">
  <div class="container">
    <h1>微信 · 支付宝 · QQ · USDT 三网收款</h1>
    <p>免输金额秒回调 ｜ 免挂机 · 免CK ｜ 易支付协议 100% 兼容 ｜ Cloudflare 全球边缘网络</p>
    <a class="btn btn-light" href="/user.html">进入商户中心</a>
    <a class="btn btn-ghost" href="/doc">接入文档</a>
    <a class="btn btn-ghost" href="/pay/1">码牌演示</a>
  </div>
</div>
${announce ? `<div class="container" style="margin-top:14px"><div class="alert alert-warning" style="margin-bottom:0"><i class="fa fa-bullhorn"></i> 公告：${announce}</div></div>` : ''}
<div class="container" style="margin-top:14px">
  <div class="row">
    ${stat(String(users?.n || 0), '入驻商户')}
    ${stat(String(ordersToday?.n || 0), '今日订单')}
    ${stat('¥' + fmt(moneyToday?.s || 0), '今日收款')}
    ${stat(String(ordersAll?.n || 0), '累计订单')}
  </div>
</div>
<div class="container sec" id="pays">
  <h2>支持的支付方式</h2>
  <p class="desc">多通道聚合，资金直进您的账户</p>
  <div class="row">
    ${pays.map((t) => `<div class="col-sm-3 col-xs-6"><div class="panel panel-default"><div class="panel-body text-center pay"><div class="name" style="color:${t[1]}">${t[0]}</div><div class="way">${t[2]}</div></div></div></div>`).join('')}
  </div>
</div>
<div class="container sec" id="feats">
  <h2>系统特性</h2>
  <p class="desc">为什么选择 ${sitename}</p>
  <div class="row">
    ${feats.map((f) => `<div class="col-sm-4"><div class="panel panel-default"><div class="panel-body card"><h3><i class="fa ${f[0]}"></i> ${f[1]}</h3><p>${f[2]}</p></div></div></div>`).join('')}
  </div>
</div>
<div class="container sec" id="flow">
  <h2>三步接入</h2>
  <p class="desc">十分钟开始收款</p>
  <div class="row">
    ${steps.map((s) => `<div class="col-sm-4"><div class="panel panel-default"><div class="panel-body step"><span class="no">${s[0]}</span><h3>${s[1]}</h3><p>${s[2]}</p></div></div></div>`).join('')}
  </div>
</div>
<div class="container" style="padding-bottom:20px">
  <div class="down">
    <h2>监控端下载</h2>
    <p class="desc">手机/电脑收到账提醒自动回传确认（个人码监控需至少一个在线端；QQ 可走 OneBot 协议端免设备）</p>
    <div class="row">
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>安卓监控 App</h3><p>Kotlin 原生通知监听，GitHub Actions 自动打包 APK</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>Windows / macOS / Linux</h3><p>Python 跨平台挂机端，通知库/账单轮询双源</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>OneBot 协议端</h3><p>NapCat/LLOneBot 对接 /onebot/report，QQ钱包到账秒确认</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>iOS</h3><p>系统限制无法后台监听，建议用免CK账单轮询渠道</p></div></div>
    </div>
    <p style="margin:12px 0 0;font-size:12px;color:rgba(255,255,255,.75)">源码：<a href="https://github.com/hackerxiaow/epay-pages">github.com/hackerxiaow/epay-pages</a></p>
  </div>
</div>
<footer><a href="/doc">接入文档</a><a href="/user.html">商户中心</a><a href="/admin.html">管理后台</a><a href="/pay/1">码牌演示</a><br/>${sitename} · Powered by Cloudflare Pages + D1</footer>
<script src="/assets/vendor/jquery/3.4.1/jquery.min.js"></script>
<script src="/assets/vendor/twitter-bootstrap/3.4.1/js/bootstrap.min.js"></script>
</body></html>`
  );
});
