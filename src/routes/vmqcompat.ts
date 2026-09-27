import { Hono } from 'hono';
import { md5 } from '../lib/sign';
import { now, str2cents } from '../lib/util';
import { Bindings } from '../lib/auth';
import { OrderRow } from '../lib/db';
import { markOrderPaid, sendMerchantNotifySafe } from '../lib/orderflow';

/**
 * 原版 V免签 (szvone/vmqApk) 兼容层 —— 拿原版安卓App直接指向本系统即可使用
 * 协议: /appHeart?t=&sign=md5(t+key)   心跳
 *       /appPush?type=1微信|2支付宝&price=&t=&sign=md5(type+price+t+key)  到账推送
 *       /getState?t=&sign=md5(t+key)   监听状态
 * 响应: {code:1,msg:"成功"} / {code:-1,msg:"..."}  (与原版 ResUtil 一致)
 */
export const vmqCompat = new Hono<{ Bindings: Bindings }>();

vmqCompat.all('/appHeart', async (c) => {
  const t = c.req.query('t') || '';
  const sign = c.req.query('sign') || '';
  const { results } = await c.env.DB.prepare("SELECT id, config FROM channels WHERE plugin='vmq' AND status=1").all<{ id: number; config: string }>();
  let valid = false;
  for (const ch of results || []) {
    try {
      const k = JSON.parse(ch.config || '{}').key;
      if (k && md5(t + k) === sign) valid = true;
    } catch {}
  }
  if (!valid) return c.json({ code: -1, msg: '签名校验错误' });
  return c.json({ code: 1, msg: '成功' });
});

vmqCompat.all('/getState', async (c) => {
  const t = c.req.query('t') || '';
  const sign = c.req.query('sign') || '';
  const { results } = await c.env.DB.prepare("SELECT id, config FROM channels WHERE plugin='vmq' AND status=1").all<{ id: number; config: string }>();
  let valid = false;
  for (const ch of results || []) {
    try {
      const k = JSON.parse(ch.config || '{}').key;
      if (k && md5(t + k) === sign) valid = true;
    } catch {}
  }
  if (!valid) return c.json({ code: -1, msg: '签名校验不通过' });
  return c.json({ code: 1, msg: '成功', data: { state: '1', lastheart: String(now()), lastpay: String(now()) } });
});

vmqCompat.all('/appPush', async (c) => {
  const form: Record<string, string> = {};
  new URL(c.req.url).searchParams.forEach((v, k) => (form[k] = v));
  if (c.req.method === 'POST') {
    try {
      const fd = await c.req.raw.formData();
      fd.forEach((v, k) => (form[k] = String(v)));
    } catch {}
  }
  const type = form.type || '';
  const price = form.price || '';
  const t = form.t || '';
  const sign = form.sign || '';
  // 时钟窗 50 秒 (与原版一致)
  const skew = Math.abs(parseInt(t, 10) - Date.now());
  if (!t || skew > 50 * 1000) return c.json({ code: -1, msg: '客户端时间错误' });
  const { results } = await c.env.DB.prepare("SELECT id, config FROM channels WHERE plugin='vmq' AND status=1").all<{ id: number; config: string }>();
  let channelId = 0;
  for (const ch of results || []) {
    try {
      const k = JSON.parse(ch.config || '{}').key;
      if (k && md5(`${type}${price}${t}${k}`) === sign) channelId = ch.id;
    } catch {}
  }
  if (!channelId) return c.json({ code: -1, msg: '签名校验错误' });
  // 原版编号: 1=微信 2=支付宝
  const payType = type === '1' ? 'wxpay' : type === '2' ? 'alipay' : '';
  const cents = str2cents(price);
  if (!payType || !cents) return c.json({ code: 1, msg: '成功' });

  const { results: orders } = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE status=0 AND channel IN (SELECT id FROM channels WHERE plugin=\'vmq\' AND status=1) AND addtime>=? ORDER BY id ASC LIMIT 50'
  )
    .bind(now() - 86400)
    .all<OrderRow>();
  for (const o of orders || []) {
    if (o.type !== payType) continue;
    let expect = o.money;
    try {
      const ext = JSON.parse(o.ext || '{}');
      if (ext.pay_amount) expect = str2cents(String(ext.pay_amount));
    } catch {}
    if (expect !== cents) continue;
    const paid = await markOrderPaid(c.env, o.trade_no, cents, 'VMQAPP' + t);
    if (paid) {
      const full = await c.env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(o.trade_no).first<OrderRow>();
      if (full) c.executionCtx.waitUntil(sendMerchantNotifySafe(c.env, full));
    }
    return c.json({ code: 1, msg: '成功' });
  }
  // 无匹配订单: 与原版一致吞掉(记为无订单转账)
  return c.json({ code: 1, msg: '成功' });
});
