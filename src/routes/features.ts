import { Hono } from 'hono';
import { Bindings, getCookie, parseSessionCookie } from '../lib/auth';
import { getConfig, getConfigAll, getUserByUid, setConfig } from '../lib/db';
import { randomStr, now, cents2str, str2cents } from '../lib/util';
import { createOrderDirect } from './proto';
import { listPlugins } from '../lib/channel';
import { rsaGenerate } from '../lib/rsa';
import { alipayTransfer } from '../lib/plugins/alipayf2f';

export const features = new Hono<{ Bindings: Bindings }>();

async function requireAdmin(env: Bindings, req: Request): Promise<boolean> {
  const syskey = (await getConfig(env.DB, 'syskey')) || '';
  const session = await parseSessionCookie(env, syskey, getCookie(req, 'epay_session'));
  return session?.role === 'admin';
}

// 公开运营统计 (仅聚合数字, 仿码支付平台首页)
features.get('/api/stats', async (c) => {
  const ts = now() - 86400;
  const [users, ordersToday, moneyToday, ordersAll] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE addtime>=?').bind(ts).first<{ n: number }>(),
    c.env.DB.prepare('SELECT IFNULL(SUM(money),0) s FROM orders WHERE status>=1 AND addtime>=?').bind(ts).first<{ s: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders').first<{ n: number }>(),
  ]);
  return c.json({
    code: 0,
    data: {
      merchants: users?.n || 0,
      orders_today: ordersToday?.n || 0,
      money_today: (moneyToday?.s || 0) / 100,
      orders_all: ordersAll?.n || 0,
    },
  });
});

// 注册配置 (公共, 供前端渲染验证码/邮箱开关)
features.get('/api/regconfig', async (c) => {
  const conf = await getConfigAll(c.env.DB);
  return c.json({ code: 0, data: { captcha_open: conf.captcha_open === '1', email_verify: conf.email_verify === '1', reg_open: conf.reg_open === '1' } });
});

// 平台公告 (公共)
features.get('/api/announcement', async (c) => {
  return c.json({ code: 0, data: (await getConfig(c.env.DB, 'announcement')) || '' });
});

// ==================== 图形验证码 ====================
features.get('/api/captcha', async (c) => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const id = randomStr(16);
  const answer = String(a + b);
  await c.env.DB.prepare('INSERT INTO regcodes (k, v, time) VALUES (?,?,?)').bind(`cap:${id}`, answer, now()).run();
  await c.env.DB.prepare('DELETE FROM regcodes WHERE time < ?').bind(now() - 600).run();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#f0f4f8"/><text x="18" y="27" font-size="20" font-family="Georgia" fill="#337ab7" transform="rotate(${Math.random() * 10 - 5} 30 20)">${a} + ${b} = ?</text><line x1="0" y1="${Math.random() * 40}" x2="120" y2="${Math.random() * 40}" stroke="#aac" stroke-width="1"/><line x1="0" y1="${Math.random() * 40}" x2="120" y2="${Math.random() * 40}" stroke="#aac" stroke-width="1"/></svg>`;
  return c.json({ code: 0, data: { id, svg } });
});

async function verifyCaptcha(env: Bindings, id: string, answer: string): Promise<boolean> {
  if (!id || !answer) return false;
  const row = await env.DB.prepare('SELECT v FROM regcodes WHERE k=?').bind(`cap:${id}`).first<{ v: string }>();
  await env.DB.prepare('DELETE FROM regcodes WHERE k=?').bind(`cap:${id}`).run();
  return !!row && row.v === answer;
}

// ==================== 码牌收款 (固定商户收款页) ====================
features.get('/pay/:uid', async (c) => {
  const uid = parseInt(c.req.param('uid'), 10);
  const user = await getUserByUid(c.env.DB, uid);
  if (!user || user.status !== 1) return c.html('<meta charset="utf-8"><body style="text-align:center;padding-top:60px;font-family:sans-serif"><h3>商户不存在</h3></body>');
  const conf = await getConfigAll(c.env.DB);
  let types: string[] = [];
  try {
    types = Object.keys(JSON.parse(conf.channel_map || '{}'));
  } catch {}
  const sitename = conf.sitename || 'Epay';
  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${user.username} - 收款</title>
<style>body{font-family:sans-serif;background:#f5f6f7;margin:0}.box{max-width:380px;margin:50px auto;background:#fff;border-radius:10px;padding:34px 28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}.t{text-align:center;color:#337ab7;font-size:20px;font-weight:700;margin-bottom:4px}.m{text-align:center;color:#999;font-size:12px;margin-bottom:24px}input,select{width:100%;padding:12px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:16px;margin-bottom:14px}.amt{font-size:28px;text-align:center}button{width:100%;padding:13px;border:0;border-radius:6px;background:#337ab7;color:#fff;font-size:16px;font-weight:600}</style></head><body>
<div class="box"><div class="t">${sitename}</div><div class="m">商户：${user.username}（ID ${uid}）</div>
<form method="get" action="/paygo/${uid}">
<input class="amt" name="money" type="number" step="0.01" min="0.01" placeholder="输入金额" required>
<select name="type">${types.map((t) => `<option value="${t}">${t === 'alipay' ? '支付宝' : t === 'wxpay' ? '微信支付' : t === 'usdt' ? 'USDT' : t}</option>`).join('')}</select>
<button type="submit">立即支付</button></form></div></body></html>`);
});

features.get('/paygo/:uid', async (c) => {
  const uid = parseInt(c.req.param('uid'), 10);
  const money = c.req.query('money') || '';
  const type = c.req.query('type') || 'alipay';
  const cents = str2cents(money);
  if (!cents) return c.html('<meta charset="utf-8"><body style="text-align:center;padding-top:60px">金额错误</body>');
  const r = await createOrderDirect(c.env, c.req.raw, {
    uid,
    type,
    money: cents,
    name: `码牌收款`,
    out_trade_no: 'CODE' + Date.now(),
    notify_url: '',
    return_url: '',
    skipRisk: true,
  });
  if (!r.ok) return c.html(`<meta charset="utf-8"><body style="text-align:center;padding-top:60px;color:#e64340">${r.msg}</body>`);
  return c.redirect(`/cashier/${r.tradeNo}`);
});

// ==================== 文档页 ====================
features.get('/doc', (c) => {
  const codeP = (body: string) => `<pre>${body.replace(/</g, '&lt;')}</pre>`;
  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>接入文档 - Epay Pages (Cloudflare 版)</title>
<link href="/assets/css/bootstrap.min.css" rel="stylesheet"/>
<style>
body{padding-top:60px;font-family:"Microsoft YaHei",-apple-system,sans-serif;background:#f5f6f7;color:#333}
.navbar-default{background-color:#337ab7;border-color:#2e6da4}
.navbar-default .navbar-brand{color:#fff}
pre{background:#282c34;color:#abb2bf;border-radius:6px;padding:14px;font-size:12px;overflow:auto;border:none}
table{font-size:13px} td,th{vertical-align:middle!important}
.sec{margin-bottom:34px}
.tip{background:#fcf8e3;border:1px solid #faebcc;border-radius:4px;padding:10px 14px;font-size:13px;color:#8a6d3b}
</style></head><body>
<nav class="navbar navbar-fixed-top navbar-default"><div class="container">
<div class="navbar-header"><a class="navbar-brand" href="/">Epay Pages 接入文档</a></div>
<ul class="nav navbar-nav navbar-right"><li><a href="/user.html">商户中心</a></li><li><a href="/admin.html">管理后台</a></li></ul>
</div></nav>
<div class="container">
<div class="sec"><h2>系统说明</h2>
<p>本系统为 <b>彩虹易支付协议兼容</b> 的聚合收款网关，基于 Cloudflare Pages + D1 构建（<b>非 PHP 程序</b>，无需虚拟主机/宝塔）。
你只需要在商户中心拿到 <code>PID</code> 与 <code>商户密钥</code>，任何支持"易支付"的程序填入三件套即可收款；自有系统可用下方任意语言直连。</p>
</div>

<div class="sec"><h2>快速开始（三步）</h2>
<ol>
<li><b>拿凭据</b>：商户中心 <code>/user.html</code> 注册/登录 → 首页查看 商户ID(PID) 与 商户密钥(key)</li>
<li><b>后台配通道</b>：管理员在 支付渠道 添加渠道并启用，然后在 系统设置 的"类型→渠道映射"填写，例如 <code>{"alipay":1,"wxpay":2,"qqpay":3,"usdt":4}</code>（值=渠道ID，可填多个逗号分隔做加权轮询）</li>
<li><b>开始收款</b>：按下方任一方式对接；没有网站也可以直接用码牌收款页 <code>/pay/你的PID</code></li>
</ol>
<p>支付方式类型：<code>alipay</code> 支付宝 · <code>wxpay</code> 微信 · <code>qqpay</code> QQ · <code>usdt</code> USDT（以平台开放为准）</p>
</div>

<div class="sec"><h2>方式A：现成易支付插件（推荐）</h2>
<p>WordPress/发卡/独角数卡等程序自带"易支付"插件，填三样：</p>
<table class="table table-bordered"><tr><th>插件字段</th><th>填什么</th></tr>
<tr><td>网关/接口地址</td><td><code>https://你的站点域名</code></td></tr>
<tr><td>商户ID(pid)</td><td>商户中心显示的数字 ID</td></tr>
<tr><td>商户密钥(key)</td><td>商户中心显示的 32 位密钥</td></tr></table>
</div>

<div class="sec"><h2>方式B：直连下单</h2>
<p><b>创建订单</b>：请求 <code>GET/POST /submit.php</code>（浏览器跳转收银台）或 <code>/mapi.php</code>（返回 JSON：code/payurl/qrcode/trade_no）</p>
<table class="table table-bordered"><tr><th>参数</th><th>必填</th><th>说明</th></tr>
<tr><td>pid</td><td>是</td><td>商户ID</td></tr>
<tr><td>type</td><td>是</td><td>支付方式</td></tr>
<tr><td>out_trade_no</td><td>是</td><td>商户订单号(唯一)</td></tr>
<tr><td>notify_url</td><td>是</td><td>异步通知地址(公网可访问)</td></tr>
<tr><td>return_url</td><td>否</td><td>支付完成同步跳转</td></tr>
<tr><td>name</td><td>是</td><td>商品名称</td></tr>
<tr><td>money</td><td>是</td><td>金额(元, 两位小数)</td></tr>
<tr><td>sign / sign_type</td><td>是</td><td>签名 / MD5 或 RSA</td></tr></table>
<h4>签名规则</h4>
<p>参数按 key ASCII 升序，排除 <code>sign/sign_type/空值</code>，<code>k=v&amp;</code> 拼接后：<b>MD5</b> = md5(拼接串+商户密钥)；<b>RSA</b> = SHA256withRSA(拼接串)，公钥在后台绑定，平台通知也用 RSA 回签。</p>
${codeP(`// Node.js 下单示例
const crypto = require('crypto');
const gw = 'https://你的站点';
const key = '商户密钥';
const p = { pid: '1', type: 'alipay', out_trade_no: 'NO' + Date.now(),
  notify_url: 'https://你的网站/notify', return_url: 'https://你的网站/ok',
  name: '商品', money: '9.99' };
const str = Object.keys(p).filter(k => p[k] !== '').sort()
  .map(k => k + '=' + p[k]).join('&');
const sign = crypto.createHash('md5').update(str + key).digest('hex');
const qs = new URLSearchParams({ ...p, sign, sign_type: 'MD5' }).toString();
// 302 跳转: gw + '/submit.php?' + qs   (mapi.php 同参数 POST 返回 JSON)`)}
${codeP(`# Python 验证异步通知 (notify)
# 平台 GET 你的 notify_url?pid=&trade_no=&out_trade_no=&type=&name=&money=&trade_status=TRADE_SUCCESS&sign=&sign_type=MD5
from urllib.parse import parse_qsl, urlsplit
import hashlib
def verify(params, key):
    items = sorted((k, v) for k, v in params.items() if k not in ('sign', 'sign_type') and v != '')
    s = '&'.join(f'{k}={v}' for k, v in items)
    return hashlib.md5((s + key).encode()).hexdigest() == params['sign']
# 验签通过后输出 success (原样小写), 否则平台最多重试 5 次`)}
</div>

<div class="sec"><h2>订单查询 / 退款</h2>
${codeP(`# 查询 (商户密钥方式)
GET /api.php?act=order&pid=商户ID&key=商户密钥&trade_no=平台订单号
# 查询 (系统签名方式)
GET /api.php?act=order&trade_no=平台订单号&sign=md5(系统密钥+订单号+系统密钥)
# 退款 (POST 表单)
POST /api.php?act=refundapi   trade_no=平台订单号 & money=金额 & key=md5(订单号+系统密钥+订单号)`)}
</div>

<div class="sec"><h2>码牌收款（无需网站）</h2>
<p>收款页：<code>/pay/你的PID</code>，买家输入金额选择支付方式即出收银台。把链接生成二维码打印即成"码牌"。</p>
</div>

<div class="sec"><h2>监控端（个人码到账确认）</h2>
<table class="table table-bordered">
<tr><th>端</th><th>方案</th></tr>
<tr><td>安卓</td><td><code>agent/android</code> 源码，GitHub Actions 自动打包 APK</td></tr>
<tr><td>Win/Mac/Linux</td><td><code>agent/desktop/vmq_agent.py</code>（通知库/dbus/支付宝账单源）</td></tr>
<tr><td>QQ</td><td>NapCat/LLOneBot 协议端 HTTP 上报地址填 <code>/onebot/report?token=后台onebot_token</code>；或后台 <code>qqbill</code> 账单轮询渠道</td></tr>
<tr><td>支付宝免挂</td><td>后台 <code>alipaybill</code> 渠道：填开放平台 APPID+密钥(免CK推荐) 或网页 Cookie</td></tr>
<tr><td>iOS</td><td>系统限制无法后台监听，请用免CK/账单轮询渠道</td></tr></table>
</div>

<div class="sec"><h2>常见问题</h2>
<ol>
<li><b>提示"签名错误"</b>：检查排序是否 ASCII 升序、是否漏排除 sign/sign_type、空值是否参与、密钥是否复制完整</li>
<li><b>订单一直待支付</b>：对应渠道未启用/映射缺失；Cookie 或监控端掉线；notify_url 不可公网访问</li>
<li><b>回调收不到</b>：notify_url 必须公网可访问且返回正文 <code>success</code>；平台最多重试 5 次</li>
<li><b>想收 USDT/QQ</b>：后台添加 BEpusdt(USDT) 或 qqbill/QQ 渠道，并更新类型映射</li>
</ol>
</div>
</div></body></html>`);
});

// ==================== 管理端扩展 ====================
features.use('/admin/api/*', async (c, next) => {
  if (!(await requireAdmin(c.env, c.req.raw))) return c.json({ code: 403, msg: '未登录' }, 403);
  await next();
});

// 订单导出 CSV (Excel 友好, 带 BOM)
features.get('/admin/api/export', async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);
  const since = now() - days * 86400;
  const { results } = await c.env.DB.prepare(
    'SELECT trade_no, out_trade_no, uid, type, name, money, realmoney, status, addtime, endtime FROM orders WHERE addtime>=? ORDER BY id DESC LIMIT 5000'
  )
    .bind(since)
    .all();
  const head = '平台订单号,商户订单号,商户ID,支付方式,商品名称,订单金额(元),实付(元),状态,下单时间,支付时间';
  const st = ['待支付', '已支付', '已退款', '已完成'];
  const lines = (results || []).map((o: Record<string, unknown>) =>
    [o.trade_no, o.out_trade_no, o.uid, o.type, `"${String(o.name || '').replace(/"/g, '""')}"`, cents2str(Number(o.money)), cents2str(Number(o.realmoney)), st[Number(o.status)] || o.status,
     o.addtime ? new Date(Number(o.addtime) * 1000).toLocaleString('zh-CN') : '', o.endtime ? new Date(Number(o.endtime) * 1000).toLocaleString('zh-CN') : ''].join(',')
  );
  const csv = '\uFEFF' + [head, ...lines].join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders_${days}d.csv"`,
    },
  });
});

// 支付用户统计
features.get('/admin/api/buyerstat', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT ip, COUNT(*) n, SUM(money) total, MAX(addtime) last FROM orders WHERE status>=1 AND ip!="" GROUP BY ip ORDER BY n DESC LIMIT 100'
  ).all();
  return c.json({ code: 0, data: results });
});

// 7日趋势
features.get('/admin/api/trend', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT date(addtime, 'unixepoch', '+8 hours') d, COUNT(*) n, SUM(CASE WHEN status>=1 THEN money ELSE 0 END) s
     FROM orders WHERE addtime>=? GROUP BY d ORDER BY d`
  )
    .bind(now() - 7 * 86400)
    .all();
  return c.json({ code: 0, data: results });
});

// 商户分组 (费率)
features.get('/admin/api/groups', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM groups ORDER BY id').all();
  return c.json({ code: 0, data: results });
});
features.post('/admin/api/groups', async (c) => {
  const b = await c.req.json<{ id?: number; name: string; rate: number }>();
  if (b.id) {
    await c.env.DB.prepare('UPDATE groups SET name=?, rate=? WHERE id=?').bind(b.name, b.rate, b.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO groups (name, rate) VALUES (?,?)').bind(b.name, b.rate).run();
  }
  return c.json({ code: 0 });
});
features.post('/admin/api/groups/delete', async (c) => {
  const { id } = await c.req.json<{ id: number }>();
  if (id === 1) return c.json({ code: -1, msg: '默认分组不可删除' });
  await c.env.DB.prepare('UPDATE users SET gid=1 WHERE gid=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM groups WHERE id=?').bind(id).run();
  return c.json({ code: 0 });
});

// 平台 RSA 密钥对生成
features.post('/admin/api/rsa/generate', async (c) => {
  const { publicPem, privatePem } = await rsaGenerate();
  await setConfig(c.env.DB, 'rsa_public', publicPem);
  await setConfig(c.env.DB, 'rsa_private', privatePem);
  return c.json({ code: 0, data: { publicPem } });
});
features.get('/admin/api/rsa', async (c) => {
  return c.json({ code: 0, data: { publicPem: (await getConfig(c.env.DB, 'rsa_public')) || '' } });
});

// 实名审核
features.get('/admin/api/certs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT uid, username, cert, cert_name, cert_no FROM users WHERE cert=1 ORDER BY uid').all();
  return c.json({ code: 0, data: results });
});
features.post('/admin/api/certs/review', async (c) => {
  const { uid, status } = await c.req.json<{ uid: number; status: number }>();
  await c.env.DB.prepare('UPDATE users SET cert=? WHERE uid=?').bind(status, uid).run();
  return c.json({ code: 0 });
});

// 结算自动打款 (支付宝转账, 需渠道启用 enable_transfer)
features.post('/admin/api/settles/pay', async (c) => {
  const { id, account, name } = await c.req.json<{ id: number; account: string; name?: string }>();
  const row = await c.env.DB.prepare('SELECT s.*, u.username FROM settles s LEFT JOIN users u ON u.uid=s.uid WHERE s.id=?').bind(id).first<{ id: number; uid: number; amount: number; status: number; username: string }>();
  if (!row) return c.json({ code: -1, msg: '记录不存在' });
  if (row.status !== 0) return c.json({ code: -1, msg: '已处理' });
  const chRow = await c.env.DB.prepare("SELECT config FROM channels WHERE plugin='alipayf2f' AND status=1").all<{ config: string }>();
  let cfgRaw = '';
  for (const ch of chRow.results || []) {
    try {
      const cfg = JSON.parse(ch.config || '{}');
      if (cfg.enable_transfer === '1') {
        cfgRaw = JSON.stringify(cfg);
        break;
      }
    } catch {}
  }
  if (!cfgRaw) return c.json({ code: -1, msg: '没有启用自动打款的支付宝渠道' });
  const r = await alipayTransfer(cfgRaw, 'ST' + row.id + '_' + now(), cents2str(row.amount), account, name || row.username, '结算打款');
  if (!r.ok) return c.json({ code: -1, msg: '打款失败: ' + r.msg });
  await c.env.DB.prepare('UPDATE settles SET status=1, note=? WHERE id=?').bind(`支付宝转账单号 ${r.orderNo || ''}`, id).run();
  return c.json({ code: 0, msg: '打款成功' });
});

// 插件清单 (供 admin.html 渲染, 含多行字段)
features.get('/admin/api/plugins', (c) => {
  return c.json({
    code: 0,
    data: listPlugins().map((p) => ({ id: p.id, name: p.name, types: p.types, inputs: p.inputs })),
  });
});
