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
  if (!user || user.status !== 1) return c.html('<meta charset="utf-8"><body style="text-align:center;padding-top:80px;font-family:sans-serif;color:#ef4444"><h3>当前商户不存在或已被禁用</h3></body>');
  const conf = await getConfigAll(c.env.DB);
  let types: string[] = [];
  try {
    types = Object.keys(JSON.parse(conf.channel_map || '{}'));
  } catch {}
  if (!types.length) types = ['alipay', 'wxpay'];
  const sitename = conf.sitename || 'Epay Pages';
  const typeMap: Record<string, string> = {
    alipay: '支付宝',
    wxpay: '微信支付',
    qqpay: 'QQ 钱包',
    usdt: 'USDT 泰达币',
  };

  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>向 ${user.username} 付款 - ${sitename}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 14px}
.pay-card{background:#ffffff;width:100%;max-width:400px;border-radius:24px;border:1px solid rgba(226,232,240,0.8);box-shadow:0 20px 40px -15px rgba(15,23,42,0.08);padding:32px 24px}
.merchant-row{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9}
.avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#38bdf8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
.m-info{display:flex;flex-direction:column}
.m-name{font-size:16px;font-weight:700;color:#0f172a}
.m-id{font-size:12px;color:#64748b}

.input-label{font-size:13px;font-weight:600;color:#64748b;margin-bottom:8px}
.amount-wrap{position:relative;display:flex;align-items:center;margin-bottom:14px}
.sym{position:absolute;left:14px;font-size:26px;font-weight:700;color:#0f172a}
.amt-input{width:100%;height:64px;padding-left:42px;padding-right:16px;border:2px solid #e2e8f0;border-radius:14px;font-size:32px;font-weight:800;color:#0f172a;outline:none;transition:border-color .2s}
.amt-input:focus{border-color:#2563eb}

.quick-pills{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:22px}
.pill{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 0;text-align:center;font-size:13px;font-weight:600;color:#475569;cursor:pointer;transition:all .15s}
.pill:hover{background:#eff6ff;color:#2563eb;border-color:#bfdbfe}

.type-select{width:100%;height:48px;padding:0 14px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;color:#0f172a;background:#fff;margin-bottom:24px;outline:none}

.btn-pay{display:block;width:100%;background:#0f172a;color:#fff;font-size:16px;font-weight:700;padding:15px;border:none;border-radius:14px;cursor:pointer;transition:all .2s;box-shadow:0 4px 14px rgba(15,23,42,0.15)}
.btn-pay:hover{background:#1e293b;transform:translateY(-1px)}
.btn-pay:active{transform:scale(0.98)}

.foot{text-align:center;font-size:11px;color:#94a3b8;margin-top:20px}
</style></head><body>

<div class="pay-card">
  <div class="merchant-row">
    <div class="avatar">${user.username.slice(0, 1).toUpperCase()}</div>
    <div class="m-info">
      <span class="m-name">${user.username}</span>
      <span class="m-id">商户号 #${uid} · ${sitename}</span>
    </div>
  </div>

  <form method="get" action="/paygo/${uid}">
    <div class="input-label">付款金额</div>
    <div class="amount-wrap">
      <span class="sym">¥</span>
      <input class="amt-input" id="amtInput" name="money" type="number" step="0.01" min="0.01" placeholder="输入金额" autofocus required>
    </div>

    <div class="quick-pills">
      <div class="pill" onclick="setAmt('5.00')">¥5</div>
      <div class="pill" onclick="setAmt('10.00')">¥10</div>
      <div class="pill" onclick="setAmt('20.00')">¥20</div>
      <div class="pill" onclick="setAmt('50.00')">¥50</div>
      <div class="pill" onclick="setAmt('100.00')">¥100</div>
    </div>

    <div class="input-label">支付方式</div>
    <select class="type-select" name="type">
      ${types.map((t) => `<option value="${t}">${typeMap[t] || t}</option>`).join('')}
    </select>

    <button class="btn-pay" type="submit">立即支付 →</button>
  </form>

  <div class="foot">安全加密支付 · 资金直达商户账户</div>
</div>

<script>
function setAmt(v){
  var el = document.getElementById('amtInput');
  el.value = v;
  el.focus();
}
</script>
</body></html>`);
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

// ==================== 文档页 (现代沉浸式开发文档) ====================
features.get('/doc', (c) => {
  const codeBox = (title: string, lang: string, code: string) => `
<div class="code-box">
  <div class="code-header">
    <div class="code-dots"><span></span><span></span><span></span></div>
    <span class="code-title">${title}</span>
    <span class="code-lang">${lang}</span>
  </div>
  <pre><code>${code.replace(/</g, '&lt;')}</code></pre>
</div>`;

  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>商户接入开发文档 - Epay Pages</title>
<style>
:root{
  --bg:#f8fafc;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --primary:#2563eb;
  --primary-hover:#1d4ed8;
  --radius:12px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{text-decoration:none;color:var(--primary)}
a:hover{text-decoration:underline}

/* 顶部导航 */
.nav-wrap{position:sticky;top:0;z-index:100;background:rgba(255,255,255,0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.nav-box{max-width:1160px;margin:0 auto;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.nav-brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:var(--text);text-decoration:none}
.nav-brand svg{width:24px;height:24px;color:var(--primary)}
.nav-links{display:flex;align-items:center;gap:20px}
.nav-links a{color:var(--text-muted);font-size:14px;font-weight:500}
.nav-links a:hover{color:var(--primary);text-decoration:none}

/* 布局 */
.layout{max-width:1160px;margin:32px auto 80px;padding:0 20px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;align-items:start}
.sidebar{position:sticky;top:92px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 12px;display:flex;flex-direction:column;gap:4px}
.sidebar a{font-size:13px;font-weight:500;color:var(--text-muted);padding:8px 14px;border-radius:8px;transition:all .15s}
.sidebar a:hover{background:var(--bg);color:var(--primary);text-decoration:none}

.content{display:flex;flex-direction:column;gap:36px}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:32px}
.section h2{font-size:22px;font-weight:800;letter-spacing:-0.5px;color:var(--text);margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.section h2::before{content:"";width:4px;height:20px;background:var(--primary);border-radius:2px;display:inline-block}
.section h3{font-size:16px;font-weight:700;margin:24px 0 10px;color:var(--text)}
.section p{font-size:14px;color:var(--text-muted);margin-bottom:14px;line-height:1.7}
.section ul,.section ol{margin-left:20px;margin-bottom:16px;color:var(--text-muted);font-size:14px;line-height:1.8}
.badge-tag{background:#eff6ff;color:var(--primary);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;font-family:monospace}

/* 表格响应式容器 */
.table-wrap{overflow-x:auto;margin:16px 0;border:1px solid var(--border);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}
th{background:#f8fafc;padding:10px 14px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border)}
td{padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text-muted)}
tr:last-child td{border-bottom:none}

/* macOS 代码块 */
.code-box{border-radius:10px;overflow:hidden;background:#0f172a;margin:16px 0;border:1px solid #1e293b}
.code-header{background:#1e293b;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;color:#94a3b8;font-size:12px}
.code-dots{display:flex;gap:6px}
.code-dots span{width:10px;height:10px;border-radius:50%}
.code-dots span:nth-child(1){background:#ef4444}
.code-dots span:nth-child(2){background:#f59e0b}
.code-dots span:nth-child(3){background:#10b981}
.code-title{font-weight:600;color:#cbd5e1}
.code-lang{text-transform:uppercase;font-size:10px;letter-spacing:0.5px}
pre{padding:16px;overflow-x:auto;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12.5px;line-height:1.6}

/* 响应式 */
@media (max-width:840px){
  .layout{grid-template-columns:1fr;gap:20px}
  .sidebar{position:static;display:none}
  .section{padding:20px}
  .section h2{font-size:19px}
}
</style></head><body>

<div class="nav-wrap">
  <div class="nav-box">
    <a class="nav-brand" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>Epay Pages 接入文档</span>
    </a>
    <div class="nav-links">
      <a href="/">首页</a>
      <a href="/user.html">商户中心</a>
      <a href="/admin.html">管理后台</a>
    </div>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <a href="#about">系统与架构</a>
    <a href="#quickstart">快速开始</a>
    <a href="#plugin">方式A: CMS插件</a>
    <a href="#direct">方式B: 直连API</a>
    <a href="#notify">异步回调与验签</a>
    <a href="#query">订单查询与退款</a>
    <a href="#paypage">码牌收款</a>
    <a href="#monitors">多端监控端</a>
    <a href="#faq">常见问题</a>
  </div>

  <div class="content">
    <div class="section" id="about">
      <h2>系统与架构说明</h2>
      <p>本系统为 <b>彩虹易支付协议 100% 兼容</b> 的高性能支付网关，完全运行于 Cloudflare 全球边缘网络（<b>非 PHP 程序</b>，基于 Cloudflare Pages + D1 强一致数据库），杜绝原版流传源码中的恶意后门与数据库注入漏洞。</p>
      <p>任何支持易支付协议的商城、发卡站、会员系统填入三件套参数即可开箱即用。同时原生支持 <b>支付宝免CK官方API模式</b>、<b>V免签安卓原生App</b>、<b>桌面挂机端</b> 与 <b>OneBot 协议端</b> 接入。</p>
    </div>

    <div class="section" id="quickstart">
      <h2>快速开始（三步接入）</h2>
      <ol>
        <li><b>获取商户凭据</b>：登录 <a href="/user.html">商户中心</a> 注册账号，在主页直接获取您的商户编号 <span class="badge-tag">PID</span> 与通信私钥 <span class="badge-tag">KEY</span>。</li>
        <li><b>配置映射通道</b>：管理员在后台创建收款通道并启用，在系统设置中通过可视化下拉完成支付类型映射（如 alipay/wxpay/qqpay/usdt）。</li>
        <li><b>接入收款</b>：将三件套参数填入网站插件即可发起收款，无需网站时也可以直接使用码牌收款。</li>
      </ol>
      <div class="table-wrap">
        <table>
          <thead><tr><th>支付类型标识</th><th>中文名称</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td><code>alipay</code></td><td>支付宝</td><td>当面付 / 个人码账单轮询 / 免CK模式</td></tr>
            <tr><td><code>wxpay</code></td><td>微信支付</td><td>官方扫码 Native V2 / 个人码监控</td></tr>
            <tr><td><code>qqpay</code></td><td>QQ 钱包</td><td>QQ 钱包账单轮询 / OneBot 协议端</td></tr>
            <tr><td><code>usdt</code></td><td>USDT 泰达币</td><td>TRC20 链上地址收款</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="plugin">
      <h2>方式A：现成易支付插件接入（推荐）</h2>
      <p>市面上 99% 的开源商城、发卡系统（如独角数卡、WordPress WooCommerce、Typecho、Z-Blog、荔枝发卡、WHMCS 等）都内置易支付插件，只需填入以下三项：</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>插件配置项</th><th>对应参数说明</th></tr></thead>
          <tbody>
            <tr><td><b>网关 / 接口地址</b></td><td><code>https://您的域名</code> （例如 <code>https://epay-pages.pages.dev</code>）</td></tr>
            <tr><td><b>商户ID (PID)</b></td><td>商户中心主页显示的数字 ID（例如 <code>1</code>）</td></tr>
            <tr><td><b>商户密钥 (KEY)</b></td><td>商户中心显示的 32 位通信私钥</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="direct">
      <h2>方式B：直连 API 接口下单</h2>
      <p>自研系统或无插件场景，可向网关发起 HTTP 请求：</p>
      <ul>
        <li><b>页面跳转方式</b>：<code>GET / POST /submit.php</code>（自动 302 携带参数重定向至收银台）</li>
        <li><b>接口返回方式</b>：<code>GET / POST /mapi.php</code>（返回 JSON 结构：含 <code>trade_no</code>, <code>payurl</code>, <code>qrcode</code>）</li>
      </ul>
      <div class="table-wrap">
        <table>
          <thead><tr><th>参数名</th><th>必填</th><th>类型</th><th>说明</th></tr></thead>
          <tbody>
            <tr><td><code>pid</code></td><td>是</td><td>Int</td><td>商户编号</td></tr>
            <tr><td><code>type</code></td><td>是</td><td>String</td><td>支付方式 (alipay / wxpay / qqpay / usdt)</td></tr>
            <tr><td><code>out_trade_no</code></td><td>是</td><td>String</td><td>商户系统唯一订单号</td></tr>
            <tr><td><code>notify_url</code></td><td>是</td><td>String</td><td>服务器异步通知完整公网 URL</td></tr>
            <tr><td><code>return_url</code></td><td>否</td><td>String</td><td>买家支付完成后同步跳转页面</td></tr>
            <tr><td><code>name</code></td><td>是</td><td>String</td><td>商品名称</td></tr>
            <tr><td><code>money</code></td><td>是</td><td>Decimal</td><td>金额（元，精确到两位小数，如 10.00）</td></tr>
            <tr><td><code>sign</code></td><td>是</td><td>String</td><td>请求数字签名</td></tr>
            <tr><td><code>sign_type</code></td><td>是</td><td>String</td><td>固定传 <code>MD5</code>（或商户配置的 <code>RSA</code>）</td></tr>
          </tbody>
        </table>
      </div>
      <h3>签名算法</h3>
      <p>将所有请求参数（排除 <code>sign</code>、<code>sign_type</code> 及空值参数）按参数名 <b>ASCII 码升序排序</b>，以 <code>k=v&</code> 拼接为待签名字符串。末尾直接拼接商户 KEY 后取 32 位小写 MD5：<code>md5(待签字符串 + KEY)</code>。</p>

      ${codeBox("Node.js 下单签名示例", "javascript", `const crypto = require('crypto');

function buildSign(params, key) {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== undefined)
    .sort();
  const queryStr = sortedKeys.map(k => k + '=' + params[k]).join('&');
  return crypto.createHash('md5').update(queryStr + key).digest('hex');
}

// 构造下单参数
const order = {
  pid: '1',
  type: 'alipay',
  out_trade_no: 'ORDER_' + Date.now(),
  notify_url: 'https://mysite.com/api/pay/notify',
  return_url: 'https://mysite.com/pay/success',
  name: '高级VIP会员月卡',
  money: '29.90',
};

const sign = buildSign(order, '您的32位商户密钥');
const payUrl = 'https://epay-pages.pages.dev/submit.php?' + new URLSearchParams({
  ...order,
  sign,
  sign_type: 'MD5'
}).toString();

console.log('请引导用户跳转此链接支付:', payUrl);`)}

      ${codeBox("Python 下单签名示例", "python", `import hashlib
from urllib.parse import urlencode

def build_sign(params, key):
    filtered = sorted((k, v) for k, v in params.items() if k not in ('sign', 'sign_type') and v != '')
    query_str = '&'.join(f'{k}={v}' for k, v in filtered)
    return hashlib.md5((query_str + key).encode('utf-8')).hexdigest()

params = {
    'pid': '1',
    'type': 'wxpay',
    'out_trade_no': 'PY_1001',
    'notify_url': 'https://mysite.com/notify',
    'name': '赞助测试',
    'money': '5.00'
}
params['sign'] = build_sign(params, '商户密钥')
params['sign_type'] = 'MD5'
print('https://epay-pages.pages.dev/submit.php?' + urlencode(params))`)}
    </div>

    <div class="section" id="notify">
      <h2>异步回调通知与验签</h2>
      <p>买家支付成功后，网关会以 <code>GET</code> 请求向商户预留的 <code>notify_url</code> 发送异步通知。商户验签通过后，<b>必须仅输出纯文本 <code>success</code></b>，否则系统将在 24 小时内启动重试机制（最多 5 次）。</p>
      ${codeBox("PHP 异步通知验签处理示例", "php", `<?php
$key = '您的商户密钥';
$params = $_GET;
$sign = $params['sign'];

// 排序并过滤空值与签名键
ksort($params);
$signParts = [];
foreach ($params as $k => $v) {
    if ($k !== 'sign' && $k !== 'sign_type' && $v !== '') {
        $signParts[] = "$k=$v";
    }
}
$expectSign = md5(implode('&', $signParts) . $key);

if ($sign === $expectSign) {
    if ($params['trade_status'] === 'TRADE_SUCCESS') {
        $tradeNo = $params['trade_no'];       // 平台订单号
        $outTradeNo = $params['out_trade_no']; // 商户订单号
        $money = $params['money'];             // 实付金额
        
        // 执行业务发货逻辑...
    }
    // 成功处理必须原样输出小写 success
    exit('success');
} else {
    exit('fail');
}`)}
    </div>

    <div class="section" id="query">
      <h2>订单查询与退款 API</h2>
      ${codeBox("API 兼容端点说明", "http", `# 1. 订单状态查询 (GET)
GET /api.php?act=order&pid=商户ID&key=商户KEY&trade_no=平台订单号

# 2. 订单退款 (POST 表单)
POST /api.php?act=refundapi
trade_no=平台订单号&money=退款金额&key=md5(trade_no+系统KEY+trade_no)`)}
    </div>

    <div class="section" id="paypage">
      <h2>码牌收款模式（无网站场景）</h2>
      <p>系统为每个商户提供专属静态聚合收银码牌页面：<code>https://您的域名/pay/商户ID</code>。</p>
      <p>无需搭建独立商城，直接将此链接打印成实体收银台台卡或发给买家，买家自主输入金额并选择支付渠道即可完成支付。</p>
    </div>

    <div class="section" id="monitors">
      <h2>多端监控生态</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户端</th><th>实现路径</th><th>运行环境</th></tr></thead>
          <tbody>
            <tr><td><b>安卓 App</b></td><td><code>agent/android</code> 原生 Kotlin，自动监控系统通知</td><td>安卓手机 / 云手机</td></tr>
            <tr><td><b>桌面守护端</b></td><td><code>agent/desktop/vmq_agent.py</code> 单文件 Python</td><td>Windows / macOS / Linux</td></tr>
            <tr><td><b>OneBot 协议端</b></td><td>NapCat / LLOneBot HTTP 上报至 <code>/onebot/report</code></td><td>QQ 机器人挂机服务器</td></tr>
            <tr><td><b>免挂免CK</b></td><td>后台 alipaybill 绑定开放平台官方 APPID 密钥</td><td>Cloudflare 云端无感对账</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="faq">
      <h2>常见接入问题</h2>
      <ol>
        <li><b>签名错误</b>：请核对是否过滤了空参数、是否包含 <code>sign</code> 与 <code>sign_type</code>，以及字母排序是否遵循严格的 ASCII 码升序。</li>
        <li><b>收不到回调通知</b>：请确保 <code>notify_url</code> 是公网可解析的有效地址，不能为 <code>localhost</code> 或带内网 IP。</li>
        <li><b>响应格式</b>：商户接收到通知处理完毕后，HTTP 响应内容必须为纯文本字符串 <code>success</code>，不可附加 HTML 标签或换行。</li>
      </ol>
    </div>
  </div>
</div>

</body></html>`);
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
