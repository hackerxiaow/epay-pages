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
    wxpay: ['微信支付', '#1aad19'],
    alipay: ['支付宝', '#1678ff'],
    qqpay: ['QQ支付', '#12b7f5'],
    usdt: ['USDT支付', '#26a17b'],
  };
  const [typeLabel, typeColor] = typeMap[o.type] || [o.type, '#1678ff'];
  return `<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${o.orderName} - 收银台</title>
<script src="/assets/vendor/jquery/3.4.1/jquery.min.js"></script>
<script src="/assets/vendor/jquery.qrcode/1.0/jquery.qrcode.min.js"></script>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;background:#f5f6f7;margin:0}
.pay-box{max-width:400px;margin:40px auto;background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.06);overflow:hidden}
.pay-head{padding:18px 24px;color:#fff;background:${typeColor};font-size:15px;display:flex;justify-content:space-between;align-items:center}
.pay-head .amt{font-size:26px;font-weight:700}
.pay-body{padding:28px 24px;text-align:center}
.order-name{color:#333;font-size:16px;margin-bottom:6px}
.order-no{color:#999;font-size:12px;margin-bottom:20px}
#qrcode{display:inline-block;padding:12px;border:1px solid #eee;border-radius:8px}
.pay-tip{color:#888;font-size:13px;margin-top:16px}
.state{color:#999;font-size:13px;margin-top:14px}
.state.ok{color:#1aad19;font-weight:700}
.err{color:#e64340;padding:30px;font-size:15px}
</style></head><body>
<div class="pay-box">
  <div class="pay-head"><span>${typeLabel}</span><span class="amt">¥${o.money}</span></div>
  <div class="pay-body">
    ${o.err ? `<div class="err">${o.err}</div>` : `
    <div class="order-name">${o.orderName}</div>
    <div class="order-no">订单号：${o.tradeNo}</div>
    ${o.qr ? (isImg ? `<img src="${o.qr}" alt="收款码" style="width:200px;border-radius:8px">` : `<div id="qrcode"></div>`) : ''}
    <div class="pay-tip" data-pay="${o.money}">${o.qr ? '请使用' + (o.type === 'usdt' ? '链上钱包' : '手机' + typeLabel) + '扫码' : '请转账'} <b style="color:${typeColor}">¥${o.money}</b>（金额含唯一尾数，请勿修改），完成后自动跳转</div>
    ${o.transferUrl ? `<a href="${o.transferUrl}" style="display:block;background:#1678ff;color:#fff;text-align:center;padding:12px;border-radius:6px;text-decoration:none;font-size:15px;margin-top:14px">打开支付宝转账（金额已填好）</a>` : ''}
    <div class="state" id="state">等待支付中…</div>`}
  </div>
</div>
<script>
if(document.getElementById('qrcode')){jQuery('#qrcode').qrcode({width:200,height:200,text:${JSON.stringify(o.qr)}});}
var timer=setInterval(function(){
  jQuery.get('/api/cashier/status?trade_no=${o.tradeNo}',function(r){
    if(r.code===0&&r.status>=1){clearInterval(timer);jQuery('#state').text('支付成功，正在跳转…').addClass('ok');
      setTimeout(function(){location.href='/payok/${o.tradeNo}';},800);}
  });
},2000);
</script></body></html>`;
}
