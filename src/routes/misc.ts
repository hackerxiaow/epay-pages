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

// ---------- 首页 (码支付平台风格: 全幅横幅 + 圆图标服务区 + 产品化文案) ----------
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
  const services = [
    ['fa-exchange', '即时到账', '支付成功资金实时到达您的收款账户，无需等待第三方结算'],
    ['fa-percent', '费率超低', '自有通道+个人码模式，综合费率最低可至零，提现更自由'],
    ['fa-lock', '安全稳定', '参数化查询+HMAC会话+风控拦截，云端全球边缘网络高可用'],
    ['fa-desktop', '多端监控', '安卓App/Windows/macOS/Linux/协议端，免挂机方案全支持'],
  ];
  const pays = [
    ['fa-alipay', '支付宝', '当面付 / 个人码 / 免CK账单', '#1678ff'],
    ['fa-weixin', '微信', '扫码 Native / 个人码监控', '#1aad19'],
    ['fa-qq', 'QQ钱包', '账单轮询 / OneBot协议端', '#12b7f5'],
    ['fa-bitcoin', 'USDT', 'TRC20 链上秒到确认', '#26a17b'],
  ];
  const feats = [
    ['fa-plug', '免签约接入', '无需营业执照与官方商户资质，注册商户即拿PID密钥，十分钟上线'],
    ['fa-code', '易支付协议兼容', '与彩虹易支付签名规则一致，市面易支付插件填三件套即可接入，支持RSA'],
    ['fa-random', '多通道聚合', '渠道池加权轮询、金额区间分流、故障自动切换，通道管理一目了然'],
    ['fa-cloud', '免挂机免CK', '云端轮询账单+开放平台官方API，手机电脑都不用挂，永不掉线'],
    ['fa-bell', '秒级回调', '到账即确认即通知，收银台自动跳转，商户余额流水实时更新'],
    ['fa-shield', '风控商户体系', 'IP黑名单/地区拦截/域名白名单/实名审核/分组费率/邀请返利'],
  ];
  const steps = [
    ['fa-user-plus', '注册商户', '商户中心注册或由管理员创建，立即获得 PID 与商户密钥'],
    ['fa-sliders', '配置渠道', '添加收款渠道并启用，"添加映射"选择支付方式对应渠道'],
    ['fa-money', '开始收款', '易支付插件填网关+PID+密钥，或直接用码牌页收款'],
  ];
  const stat = (n: string, label: string, icon: string) =>
    `<div class="stat"><i class="fa ${icon}"></i><div class="stat-n">${n}</div><div class="stat-l">${label}</div></div>`;
  const secTitle = (t: string, d: string) =>
    `<div class="sec-head"><h2>${t}</h2><p>${d}</p></div>`;
  return c.html(
    `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sitename} - 免签聚合收款系统｜支付宝/微信/QQ/USDT</title>
<link href="/assets/css/bootstrap.min.css" rel="stylesheet"/>
<link href="/assets/vendor/font-awesome/css/font-awesome.min.css" rel="stylesheet"/>
<style>
body{padding-top:50px;font-family:"Microsoft YaHei",-apple-system,"Helvetica Neue",sans-serif;background:#fff;color:#333}
.navbar-default{background-color:rgba(20,40,80,.96);border-color:transparent}
.navbar-default .navbar-brand,.navbar-default .navbar-nav>li>a{color:#fff}
.navbar-default .navbar-nav>.active>a{color:#ffd04b;background:transparent}
.navbar-default .navbar-nav>li>a:focus,.navbar-default .navbar-nav>li>a:hover{color:#ffd04b}
.navbar-default .navbar-toggle .icon-bar{background-color:#fff}
.banner{background:radial-gradient(1200px 500px at 20% -10%,rgba(90,150,255,.5),transparent),linear-gradient(120deg,#122a56,#1f4fa0 55%,#2d6ae3);color:#fff;padding:64px 0 0;position:relative;overflow:hidden}
.banner h1{font-size:34px;font-weight:800;letter-spacing:1px;margin:0 0 14px}
.banner h1 em{font-style:normal;color:#ffd04b}
.banner p.lead{font-size:15px;opacity:.92;margin:0 0 24px}
.banner .btn{border-radius:30px;padding:11px 34px;margin:0 8px 8px 0}
.btn-gold{background:#ffd04b;border-color:#ffd04b;color:#1f2c4d;font-weight:700}
.btn-gold:hover{background:#ffdd70}
.btn-outline{border:1px solid rgba(255,255,255,.65);color:#fff;background:transparent}
.btn-outline:hover{background:rgba(255,255,255,.12);color:#fff}
.stats-band{margin-top:36px;background:rgba(255,255,255,.08);border-top:1px solid rgba(255,255,255,.15);padding:18px 0}
.stat{display:inline-block;margin:0 34px;color:#fff;text-align:center}
.stat i{font-size:20px;color:#ffd04b}
.stat-n{font-size:22px;font-weight:800}
.stat-l{font-size:12px;opacity:.75}
.sec{padding:52px 0 8px}
.sec-head{text-align:center;margin-bottom:34px}
.sec-head h2{font-size:24px;font-weight:700;margin:0 0 8px}
.sec-head p{color:#9aa7b8;font-size:13px;margin:0}
.sec-head:after{content:'';display:block;width:44px;height:3px;border-radius:2px;background:#2d6ae3;margin:14px auto 0}
.svc{background:#f6f9ff;padding:52px 0 30px}
.svc .ico{width:74px;height:74px;line-height:74px;border-radius:50%;margin:0 auto 14px;color:#fff;font-size:28px;background:linear-gradient(135deg,#4a89dc,#2d6ae3);box-shadow:0 8px 18px rgba(45,106,227,.35)}
.svc .card{background:#fff;border-radius:10px;padding:26px 18px;text-align:center;border:none;box-shadow:0 4px 16px rgba(31,79,160,.08);transition:all .25s}
.svc .card:hover{transform:translateY(-6px);box-shadow:0 12px 26px rgba(31,79,160,.16)}
.svc h3{font-size:16px;font-weight:700;margin:0 0 8px}
.svc p{font-size:13px;color:#8a97a8;margin:0;line-height:1.8}
.paycard{background:#fff;border-radius:10px;padding:22px 14px;text-align:center;border:1px solid #eef2f8;box-shadow:0 4px 16px rgba(31,79,160,.06);transition:all .25s}
.paycard:hover{transform:translateY(-6px);box-shadow:0 12px 26px rgba(31,79,160,.14)}
.paycard i{font-size:30px}
.paycard .name{font-size:16px;font-weight:700;margin:8px 0 4px}
.paycard .way{font-size:12px;color:#9aa7b8}
.cardx{background:#fff;border-radius:10px;padding:24px 20px;border:none;box-shadow:0 4px 16px rgba(31,79,160,.07);transition:all .25s;height:100%}
.cardx:hover{transform:translateY(-5px);box-shadow:0 12px 26px rgba(31,79,160,.14)}
.cardx i{font-size:24px;color:#2d6ae3}
.cardx h3{font-size:15px;font-weight:700;margin:10px 0 6px}
.cardx p{font-size:13px;color:#8a97a8;margin:0;line-height:1.8}
.stepx{text-align:center;padding:24px 16px}
.stepx .no{width:56px;height:56px;line-height:56px;border-radius:50%;background:linear-gradient(135deg,#ffd04b,#ffb02e);color:#1f2c4d;font-size:22px;font-weight:800;margin:0 auto 12px;box-shadow:0 8px 18px rgba(255,176,46,.35)}
.stepx h3{font-size:15px;font-weight:700;margin:0 0 6px}
.stepx p{font-size:13px;color:#8a97a8;margin:0;line-height:1.7}
.downx{background:linear-gradient(120deg,#122a56,#1f4fa0);border-radius:14px;color:#fff;padding:34px;margin:52px auto 30px;box-shadow:0 16px 40px rgba(18,42,86,.35)}
.downx h2{font-size:20px;font-weight:700;margin:0 0 6px}
.downx .d{color:rgba(255,255,255,.8);font-size:13px;margin:0 0 18px}
.downx .item{background:rgba(255,255,255,.1);border-radius:10px;padding:18px;height:100%}
.downx .item h3{font-size:14px;font-weight:700;margin:0 0 6px}
.downx .item p{font-size:12px;color:rgba(255,255,255,.85);margin:0;line-height:1.8}
.downx a{color:#ffd04b}
footer{background:#122a56;color:#8fa3c4;text-align:center;font-size:12px;padding:26px}
footer a{color:#c6d4ea;margin:0 8px;text-decoration:none}
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
        <li class="active"><a href="/">主页</a></li>
        <li><a href="/doc">接入文档</a></li>
        <li><a href="/admin.html">管理后台</a></li>
      </ul>
      <ul class="nav navbar-nav navbar-right">
        <li><a href="/user.html"><i class="fa fa-user-circle"></i> 商户登录/注册</a></li>
      </ul>
    </div>
  </div>
</nav>
<div class="banner">
  <div class="container text-center">
    <h1>让每一笔收款 <em>简单直达</em></h1>
    <p class="lead">支付宝 / 微信 / QQ / USDT 三网聚合 · 免签约 · 即时到账 · 免挂机免CK · 秒级回调</p>
    <a class="btn btn-gold" href="/user.html">立即接入</a>
    <a class="btn btn-outline" href="/doc">查看文档</a>
    <a class="btn btn-outline" href="/pay/1">码牌演示</a>
    <div class="stats-band">
      ${stat(String(users?.n || 0), '入驻商户', 'fa-users')}
      ${stat(String(ordersToday?.n || 0), '今日订单', 'fa-list-alt')}
      ${stat('¥' + fmt(moneyToday?.s || 0), '今日收款', 'fa-cny')}
      ${stat(String(ordersAll?.n || 0), '累计订单', 'fa-database')}
    </div>
  </div>
</div>
${announce ? `<div class="container" style="margin-top:16px"><div class="alert alert-warning" style="margin-bottom:0;border-radius:8px"><i class="fa fa-bullhorn"></i> 公告：${announce}</div></div>` : ''}
<div class="svc">
  <div class="container">
    <div class="sec-head"><h2>我们拥有比同行更优质的服务</h2><p>自助接入 · 即时到账 · 全天候可用</p></div>
    <div class="row">
      ${services.map((f) => `<div class="col-sm-3 col-xs-6"><div class="card"><div class="ico"><i class="fa ${f[0]}"></i></div><h3>${f[1]}</h3><p>${f[2]}</p></div></div>`).join('')}
    </div>
  </div>
</div>
<div class="container sec" id="pays">
  <div class="sec-head"><h2>支持的支付方式</h2><p>多通道聚合，资金直进您的账户</p></div>
  <div class="row">
    ${pays.map((t) => `<div class="col-sm-3 col-xs-6"><div class="paycard"><i class="fa ${t[0]}" style="color:${t[3]}"></i><div class="name">${t[1]}</div><div class="way">${t[2]}</div></div></div>`).join('')}
  </div>
</div>
<div class="sec" style="background:#f6f9ff;padding:52px 0 30px">
  <div class="container">
    <div class="sec-head"><h2>产品核心优势</h2><p>为什么选择 ${sitename}</p></div>
    <div class="row">
      ${feats.map((f) => `<div class="col-sm-4"><div class="cardx"><i class="fa ${f[0]}"></i><h3>${f[1]}</h3><p>${f[2]}</p></div></div>`).join('')}
    </div>
  </div>
</div>
<div class="container sec" id="flow">
  <div class="sec-head"><h2>三步接入</h2><p>十分钟开始收款</p></div>
  <div class="row">
    ${steps.map((s) => `<div class="col-sm-4"><div class="stepx"><div class="no">${s[0]}</div><h3>${s[1]}</h3><p>${s[2]}</p></div></div>`).join('')}
  </div>
</div>
<div class="container">
  <div class="downx">
    <h2>监控端下载</h2>
    <p class="d">个人码到账确认需至少一个在线端；QQ 可走 OneBot 协议端免设备；支付宝可走免CK账单轮询无需任何设备</p>
    <div class="row">
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>安卓监控 App</h3><p>Kotlin 原生通知监听，GitHub Actions 自动打包 APK</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>Win / macOS / Linux</h3><p>Python 跨平台挂机端，通知库/账单轮询双源</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>OneBot 协议端</h3><p>NapCat/LLOneBot 对接，QQ钱包到账秒确认</p></div></div>
      <div class="col-sm-3 col-xs-6"><div class="item"><h3>iOS</h3><p>系统限制无法后台监听，建议免CK账单轮询渠道</p></div></div>
    </div>
    <p style="margin:14px 0 0;font-size:12px;color:rgba(255,255,255,.7)">源码仓库：<a href="https://github.com/hackerxiaow/epay-pages">github.com/hackerxiaow/epay-pages</a></p>
  </div>
</div>
<footer><a href="/doc">接入文档</a><a href="/user.html">商户中心</a><a href="/admin.html">管理后台</a><a href="/pay/1">码牌演示</a><br/>© ${sitename} · Powered by Cloudflare Pages + D1</footer>
<script src="/assets/vendor/jquery/3.4.1/jquery.min.js"></script>
<script src="/assets/vendor/twitter-bootstrap/3.4.1/js/bootstrap.min.js"></script>
</body></html>`
  );
});
