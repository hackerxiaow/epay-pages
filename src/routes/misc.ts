import { Hono } from 'hono';
import { Bindings, hashPassword } from '../lib/auth';
import { getConfig, OrderRow } from '../lib/db';
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
  return c.json({ code: 0, data: { retried: ok, time: now() } });
});

// ---------- 首页 (原版风格落地页) ----------
misc.get('/', (c) => {
  return c.html(
    `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Epay Pages - 免签支付系统</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:#f5f6f7;color:#333}
.hero{background:linear-gradient(135deg,#4a89dc,#5d9cec);color:#fff;padding:70px 20px;text-align:center}
.hero h1{margin:0 0 12px;font-size:32px;font-weight:700}
.hero p{margin:0 0 28px;opacity:.9;font-size:15px}
.btn{display:inline-block;padding:12px 34px;border-radius:4px;text-decoration:none;font-size:15px;margin:0 8px}
.btn-light{background:#fff;color:#4a89dc;font-weight:600}
.btn-ghost{border:1px solid rgba(255,255,255,.7);color:#fff}
.feats{max-width:880px;margin:40px auto;padding:0 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.feat{background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.feat h3{margin:0 0 8px;font-size:16px;color:#4a89dc}
.feat p{margin:0;color:#777;font-size:13px;line-height:1.7}
footer{text-align:center;color:#aaa;font-size:12px;padding:30px}
</style></head><body>
<div class="hero">
  <h1>Epay Pages</h1>
  <p>彩虹易支付协议兼容 · Cloudflare Pages + D1 重构版 · 去除后门 · 免挂机/挂机双支持</p>
  <a class="btn btn-light" href="/user.html">商户中心</a>
  <a class="btn btn-ghost" href="/admin.html">管理后台</a>
</div>
<div class="feats">
  <div class="feat"><h3>协议 100% 兼容</h3><p>submit.php / mapi.php / api.php 与彩虹易支付签名规则一致，现有易支付商户插件无缝接入。</p></div>
  <div class="feat"><h3>即时到账</h3><p>支付成功瞬间商户余额自动入账，流水可查；提现走结算审核。</p></div>
  <div class="feat"><h3>免挂机 / 云端挂机</h3><p>BEPusdt(USDT)、XorPay、易支付上游均免挂机；V免签协议兼容，挂机端可跑在云手机。</p></div>
  <div class="feat"><h3>无后门架构</h3><p>TypeScript 重写，D1 参数化查询，会话 HMAC 签名，根密钥不进响应。</p></div>
</div>
<footer>Epay Pages · Powered by Cloudflare Workers Runtime</footer></body></html>`
  );
});
