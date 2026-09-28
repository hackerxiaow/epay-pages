import { Hono } from 'hono';
import { Bindings, getCookie, makeSessionCookie, parseSessionCookie, verifyPassword } from '../lib/auth';
import { getConfig, getConfigAll, getUserByUid, OrderRow, setConfig } from '../lib/db';
import { md5 } from '../lib/sign';
import { cents2str, genTradeNo, now, str2cents } from '../lib/util';
import { getExternalOrigin, getPlugin, parseChannel } from '../lib/channel';
import { buildReturnUrl, verifyMerchantSign } from '../lib/orderflow';
import { resolveChannel, isBlacklisted } from '../lib/routing';

export const proto = new Hono<{ Bindings: Bindings }>();

interface SubParams {
  pid: string;
  type: string;
  out_trade_no: string;
  notify_url: string;
  return_url: string;
  name: string;
  money: string;
  sitename: string;
  sign: string;
  sign_type: string;
}

function collectParams(query: Record<string, string>): SubParams {
  return {
    pid: query.pid || '',
    type: (query.type || '').toLowerCase(),
    out_trade_no: query.out_trade_no || '',
    notify_url: query.notify_url || '',
    return_url: query.return_url || '',
    name: query.name || '',
    money: query.money || '',
    sitename: query.sitename || '',
    sign: query.sign || '',
    sign_type: query.sign_type || 'MD5',
  };
}

export interface DirectOrderOpts {
  uid: number;
  type: string;
  money: number; // 分
  name: string;
  out_trade_no: string;
  notify_url: string;
  return_url: string;
  skipRisk?: boolean; // 码牌等站内场景跳过来源风控
}

/** 站内直接下单 (码牌收款), 无需商户签名 */
export async function createOrderDirect(
  env: Bindings,
  req: Request,
  o: DirectOrderOpts
): Promise<{ ok: boolean; msg: string; tradeNo?: string }> {
  const user = await getUserByUid(env.DB, o.uid);
  if (!user || user.status !== 1) return { ok: false, msg: '商户不存在或已被禁用' };
  const conf = await getConfigAll(env.DB);
  if (conf.cert_force === '1' && user.cert !== 2) return { ok: false, msg: '商户未完成实名认证' };
  const clientIp = req.headers.get('cf-connecting-ip') || '';
  if (!o.skipRisk && isBlacklisted(conf.blacklist || '', clientIp)) return { ok: false, msg: '请求被拒绝' };
  const routed = await resolveChannel(env.DB, o.type, o.money);
  if (!routed.ok) return { ok: false, msg: routed.msg || '无可用通道' };
  const tradeNo = genTradeNo();
  await env.DB.prepare(
    'INSERT INTO orders (trade_no, out_trade_no, uid, type, channel, name, money, status, addtime, notify_url, return_url, domain, ip) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)'
  )
    .bind(tradeNo, o.out_trade_no, o.uid, o.type, routed.channelId!, o.name, o.money, now(), o.notify_url, o.return_url, '', clientIp)
    .run();
  return { ok: true, msg: 'ok', tradeNo };
}

/** 商户协议下单: 验签 + 风控 + 路由 + 落库 */
export async function createOrder(
  env: Bindings,
  req: Request,
  p: SubParams
): Promise<{ ok: boolean; msg: string; tradeNo?: string }> {
  if (!p.pid || !p.type || !p.out_trade_no || !p.notify_url || !p.money) {
    return { ok: false, msg: '参数不完整' };
  }
  if (p.sign_type !== 'MD5' && p.sign_type !== 'RSA' && p.sign_type !== 'RSA2') {
    return { ok: false, msg: '不支持的签名类型' };
  }
  const uid = parseInt(p.pid, 10);
  const user = await getUserByUid(env.DB, uid);
  if (!user || user.status !== 1) return { ok: false, msg: '商户不存在或已被禁用' };
  if (!(await verifyMerchantSign(user, p as unknown as Record<string, string>, p.sign))) {
    return { ok: false, msg: '签名错误' };
  }
  const money = str2cents(p.money);
  if (money <= 0) return { ok: false, msg: '金额错误' };

  const conf = await getConfigAll(env.DB);
  // 实名强制
  if (conf.cert_force === '1' && user.cert !== 2) return { ok: false, msg: '商户未完成实名认证' };
  // 客户端 IP 与地区风控
  const clientIp = req.headers.get('cf-connecting-ip') || '';
  if (isBlacklisted(conf.blacklist || '', clientIp)) return { ok: false, msg: '请求被拒绝' };
  const blocked = (conf.block_countries || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const country = ((req as Request & { cf?: { country?: string } }).cf?.country || '').toUpperCase();
  if (blocked.length && country && blocked.includes(country)) return { ok: false, msg: '请求被拒绝' };
  // 域名白名单
  if (conf.auth_domain === '1' && user.domain) {
    const referer = req.headers.get('referer') || '';
    const host = referer ? new URL(referer).hostname : '';
    const allowed = user.domain.split(',').map((x) => x.trim()).filter(Boolean);
    if (!host || !allowed.includes(host)) return { ok: false, msg: '来源域名未授权' };
  }

  const routed = await resolveChannel(env.DB, p.type, money);
  if (!routed.ok) return { ok: false, msg: routed.msg || '无可用通道' };
  const channelId = routed.channelId!;

  const tradeNo = genTradeNo();
  await env.DB.prepare(
    'INSERT INTO orders (trade_no, out_trade_no, uid, type, channel, name, money, status, addtime, notify_url, return_url, domain, ip) VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)'
  )
    .bind(
      tradeNo,
      p.out_trade_no,
      uid,
      p.type,
      channelId,
      p.name,
      money,
      now(),
      p.notify_url,
      p.return_url,
      req.headers.get('referer') ? new URL(req.headers.get('referer')!).hostname : '',
      req.headers.get('cf-connecting-ip') || ''
    )
    .run();

  return { ok: true, msg: 'ok', tradeNo };
}

/** 调渠道插件创建上游订单 */
async function pluginCreate(env: Bindings, req: Request, order: OrderRow) {
  const chRow = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(order.channel!).first<{
    id: number;
    plugin: string;
    name: string;
    status: number;
    config: string;
    types: string;
  }>();
  if (!chRow) return { ok: false, msg: '渠道不存在' };
  const ch = parseChannel(chRow);
  const plugin = getPlugin(ch.plugin);
  if (!plugin) return { ok: false, msg: '插件未实现' };
  return await plugin.createOrder({
    env,
    channel: { id: ch.id, plugin: ch.plugin, config: ch.config },
    order,
    payType: order.type,
    siteUrl: getExternalOrigin(req),
  });
}

async function loadOrder(env: Bindings, tradeNo: string): Promise<OrderRow | null> {
  return await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(tradeNo).first<OrderRow>();
}

// ---------- submit.php (浏览器提交, 跳转收银台) ----------
for (const path of ['/submit.php', '/submit']) {
  proto.all(path, async (c) => {
    const query = c.req.method === 'GET' ? c.req.query() : await mergeForm(c.req.raw);
    const p = collectParams(query as Record<string, string>);
    const r = await createOrder(c.env, c.req.raw, p);
    if (!r.ok) return c.html(errorPage(p.sitename, r.msg));
    return c.redirect(`/cashier/${r.tradeNo}`, 302);
  });
}

// ---------- mapi.php (接口提交, 返回 JSON) ----------
for (const path of ['/mapi.php', '/mapi']) {
  proto.all(path, async (c) => {
    const query = c.req.method === 'GET' ? c.req.query() : await mergeForm(c.req.raw);
    const p = collectParams(query as Record<string, string>);
    const r = await createOrder(c.env, c.req.raw, p);
    if (!r.ok) return c.json({ code: -1, msg: r.msg });
    const order = await loadOrder(c.env, r.tradeNo!);
    const pr = await pluginCreate(c.env, c.req.raw, order!);
    if (!pr.ok) return c.json({ code: -1, msg: pr.msg });
    return c.json({
      code: 1,
      trade_no: r.tradeNo,
      payurl: pr.payUrl || '',
      qrcode: pr.qrContent || '',
      img: pr.qrContent || '',
    });
  });
}

// ---------- 收银台 ----------
proto.get('/cashier/:tradeNo', async (c) => {
  const order = await loadOrder(c.env, c.req.param('tradeNo'));
  if (!order) return c.html(errorPage('', '订单不存在'));
  if (order.status >= 1) return c.redirect(`/payok/${order.trade_no}`);
  const pr = await pluginCreate(c.env, c.req.raw, order);
  if (pr.ok && pr.payUrl) return c.redirect(pr.payUrl);
  const user = await getUserByUid(c.env.DB, order.uid);
  const qr = pr.ok ? pr.qrContent || '' : '';
  const name = pr.ok ? '' : (pr.msg || '创建支付失败');
  return c.html(
    cashierPage({
      siteName: (await getConfig(c.env.DB, 'sitename')) || 'Epay',
      tradeNo: order.trade_no,
      orderName: order.name || '商品订单',
      money: (pr.payAmount || cents2str(order.money)),
      type: order.type,
      qr,
      merchant: user?.username || String(order.uid),
      err: name,
      transferUrl: pr.transferUrl || '',
    })
  );
});

// 收银台轮询 (同时驱动账单懒轮询: 买家页面每2秒一次, 30秒节流)
proto.get('/api/cashier/status', async (c) => {
  const tradeNo = c.req.query('trade_no') || '';
  const order = await loadOrder(c.env, tradeNo);
  if (!order) return c.json({ code: -1, msg: '订单不存在' });
  const { pollAllBills } = await import('../lib/billpoll');
  c.executionCtx.waitUntil(pollAllBills(c.env));
  return c.json({ code: 0, status: order.status });
});

// 兼容原版 getshop.php
proto.all('/getshop.php', async (c) => {
  const tradeNo = c.req.query('trade_no') || '';
  const order = await loadOrder(c.env, tradeNo);
  if (!order) return c.json({ code: -2, msg: 'No trade_no!' });
  if (order.status >= 1) {
    const jump = order.return_url ? await buildReturnUrl(c.env, order) : '/payok.html';
    return c.json({ code: 1, msg: '付款成功', backurl: jump });
  }
  return c.json({ code: -1, msg: '未付款' });
});

// 支付成功页/回跳: 带签名参数 302 回商户 return_url
proto.get('/payok/:tradeNo', async (c) => {
  const order = await loadOrder(c.env, c.req.param('tradeNo'));
  if (!order) return c.html(errorPage('', '订单不存在'));
  if (order.status === 0) return c.redirect(`/cashier/${order.trade_no}`);
  const url = await buildReturnUrl(c.env, order);
  if (url) return c.redirect(url);
  return c.html(
    `<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:60px"><h2 style="color:#1aad19">✔ 支付成功</h2><p>订单号 ${order.trade_no}</p></body>`
  );
});

// ---------- api.php 兼容 (订单查询 / 退款) ----------
proto.all('/api.php', async (c) => {
  const bodyOnce: Record<string, string> = {};
  if (c.req.method === 'POST') {
    try {
      const form = await c.req.raw.formData();
      form.forEach((v, k) => (bodyOnce[k] = String(v)));
    } catch {}
  }
  const act = c.req.query('act') || bodyOnce.act || 'order';
  const conf = await getConfigAll(c.env.DB);
  const syskey = conf.syskey || '';

  if (act === 'order') {
    const tradeNo = c.req.query('trade_no') || '';
    if (!tradeNo) return c.json({ code: -3, msg: 'trade_no 不能为空' });
    const order = await loadOrder(c.env, tradeNo);
    if (!order) return c.json({ code: -3, msg: '订单不存在' });
    // 两种鉴权: 商户 key 直传 (原版兼容) 或 md5(SYS_KEY.trade_no.SYS_KEY) 签名
    const pid = parseInt(c.req.query('pid') || '0', 10);
    const key = c.req.query('key') || '';
    const user = await getUserByUid(c.env.DB, order.uid);
    const authed =
      (user && pid === order.uid && key === user.key) ||
      (syskey !== '' && c.req.query('sign') === md5(syskey + tradeNo + syskey));
    if (!authed) return c.json({ code: -3, msg: '商户密钥错误' });
    return c.json({
      code: 1,
      trade_no: order.trade_no,
      out_trade_no: order.out_trade_no,
      uid: order.uid,
      type: order.type,
      name: order.name,
      money: cents2str(order.money),
      status: order.status,
      addtime: order.addtime,
      endtime: order.endtime,
    });
  }

  if (act === 'refundapi') {
    const body = bodyOnce;
    const tradeNo = String(body.trade_no || '');
    const money = String(body.money || '');
    if (!/^[\d.]+$/.test(money)) return c.json({ code: -1, msg: '金额输入错误' });
    if (String(body.key || '') !== (syskey ? md5(tradeNo + syskey + tradeNo) : '')) return c.json({ code: -1, msg: '密钥错误' });
    const { markOrderRefunded } = await import('../lib/db');
    const r = await markOrderRefunded(c.env, tradeNo);
    return c.json({ code: r.ok ? 0 : -1, msg: r.ok ? '退款成功！退款金额￥' + money : r.msg });
  }

  return c.json({ code: -5, msg: 'No Act!' });
});

// ---------- 工具 ----------
async function mergeForm(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => (out[k] = v));
  try {
    const form = await req.formData();
    form.forEach((v, k) => (out[k] = String(v)));
  } catch {}
  return out;
}

function errorPage(sitename: string, msg: string): string {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#f2f2f2"><div style="max-width:420px;margin:60px auto;background:#fff;border-radius:8px;padding:40px 30px;text-align:center"><h3 style="color:#e64340;margin:0 0 16px">支付失败</h3><p style="color:#666">${msg}</p><p style="color:#999;font-size:12px">${sitename}</p></div></body>`;
}

function cashierPage(o: {
  siteName: string;
  tradeNo: string;
  orderName: string;
  money: string;
  type: string;
  qr: string;
  merchant: string;
  err: string;
  transferUrl?: string;
}): string {
  const isImg = /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(o.qr);
  const typeMap: Record<string, [string, string]> = {
    wxpay: ['微信支付', '#10b981'],
    alipay: ['支付宝', '#2563eb'],
    qqpay: ['QQ 钱包', '#0284c7'],
    usdt: ['USDT 泰达币', '#059669'],
    bank: ['银联 / 云闪付', '#d97706'],
    paypal: ['PayPal 贝宝', '#0070ba'],
    jdpay: ['京东支付', '#e1251b'],
  };
  const [typeLabel, typeColor] = typeMap[o.type] || [o.type.toUpperCase(), '#334155'];

  return `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${o.orderName} - 收银台</title>
<style>
:root{
  --bg:#f1f5f9;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --color:${typeColor};
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px}
.checkout-card{background:var(--surface);width:100%;max-width:400px;border-radius:24px;border:1px solid rgba(226,232,240,0.8);box-shadow:0 20px 40px -15px rgba(15,23,42,0.08);overflow:hidden;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.card-top{padding:24px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.site-badge{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text)}
.secure-pill{font-size:11px;font-weight:600;color:#059669;background:#ecfdf5;padding:4px 10px;border-radius:100px;display:flex;align-items:center;gap:4px}

.card-body{padding:28px 24px 32px;text-align:center}
.channel-pill{display:inline-flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);color:var(--text);font-size:13px;font-weight:600;padding:6px 14px;border-radius:100px;margin-bottom:16px}
.amount-box{margin-bottom:12px}
.amount-box .sym{font-size:24px;font-weight:700;margin-right:2px}
.amount-box .val{font-size:44px;font-weight:800;letter-spacing:-1px;color:var(--text)}

.order-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px}
.order-num{font-size:12px;color:var(--text-muted);font-family:monospace}

.qr-box{margin:24px auto 16px;width:200px;height:200px;background:#fff;border:1px solid var(--border);border-radius:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.04);padding:8px}
.qr-box img{width:184px;height:184px;border-radius:12px;display:block}
#qrcode{width:184px;height:184px;display:flex;align-items:center;justify-content:center}

.pay-tip{font-size:13px;color:var(--text-muted);margin:16px 0 20px;line-height:1.6}
.pay-tip b{color:var(--color)}

.btn-transfer{display:block;width:100%;background:var(--color);color:#fff;font-size:15px;font-weight:700;padding:14px;border-radius:14px;text-decoration:none;margin-top:16px;box-shadow:0 4px 14px -2px rgba(37,99,235,0.4);transition:all .2s}
.btn-transfer:active{transform:scale(0.98);opacity:0.9}

.status-pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--text-muted);background:#f8fafc;border:1px solid var(--border);padding:6px 16px;border-radius:100px;margin-top:20px}
.pulse-dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.85)}}

.status-pill.success{background:#ecfdf5;border-color:#a7f3d0;color:#059669;font-weight:700}
.status-pill.success .pulse-dot{background:#10b981;animation:none}

.card-foot{margin-top:24px;font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;border-top:1px dashed var(--border);padding-top:16px}
</style></head><body>

<div class="checkout-card">
  <div class="card-top">
    <div class="site-badge">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>${o.siteName}</span>
    </div>
    <div class="secure-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>安全收银台</span>
    </div>
  </div>

  <div class="card-body">
    ${o.err ? `<div style="color:#ef4444;padding:30px 0;font-weight:600">${o.err}</div>` : `
    <div class="channel-pill">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${typeColor}"></span>
      <span>${typeLabel}</span>
    </div>

    <div class="amount-box">
      <span class="sym">¥</span><span class="val" data-pay="${o.money}">${o.money}</span>
    </div>

    <div class="order-title">${o.orderName}</div>
    <div class="order-num">单号：${o.tradeNo}</div>

    ${o.qr ? (isImg
      ? `<div class="qr-box"><img src="${o.qr}" alt="收款码"></div>`
      : `<div class="qr-box"><div id="qrcode"></div></div>`)
      : ''}

    <div class="pay-tip">
      ${o.qr ? '请使用手机' + typeLabel + '扫码支付' : '请向上方账户完成转账'} <b>¥${o.money}</b><br>
      <span style="font-size:11px">金额含专属校验尾数，请勿修改金额，支付后自动跳转</span>
    </div>

    ${o.transferUrl ? `<a class="btn-transfer" href="${o.transferUrl}">打开${typeLabel}（金额已填好） →</a>` : ''}

    <div>
      <div class="status-pill" id="state">
        <span class="pulse-dot"></span>
        <span>等待扫码支付中…</span>
      </div>
    </div>

    <div class="card-foot">
      <span>商户：${o.merchant}</span>
      <span>支付中请勿关闭</span>
    </div>`}
  </div>
</div>

<script src="/assets/vendor/jquery/3.4.1/jquery.min.js?v=1"></script>
<script src="/assets/vendor/jquery.qrcode/1.0/jquery.qrcode.min.js?v=1"></script>
<script>
if(document.getElementById('qrcode')){jQuery('#qrcode').qrcode({width:176,height:176,text:${JSON.stringify(o.qr)}});}
var timer=setInterval(function(){
  jQuery.get('/api/cashier/status?trade_no=${o.tradeNo}',function(r){
    if(r.code===0&&r.status>=1){
      clearInterval(timer);
      var st=jQuery('#state');
      st.addClass('success').html('<span class="pulse-dot"></span><span>支付成功，正在跳转…</span>');
      setTimeout(function(){location.href='/payok/${o.tradeNo}';},800);
    }
  });
},2000);
</script></body></html>`
}
