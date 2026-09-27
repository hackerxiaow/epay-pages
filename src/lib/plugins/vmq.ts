import { md5 } from '../sign';
import { cents2str, now, str2cents } from '../util';
import { Bindings } from '../auth';
import { ChannelCtx, ChannelPlugin, NotifyResult } from '../channel';
import { markOrderPaid, sendMerchantNotifySafe } from '../orderflow';
import { OrderRow } from '../db';
import { ensurePayAmount } from './alipaybill';

/**
 * V免签 (VMQ) 兼容协议: 挂机端 App 轮询取单 + 推送到账。
 * 挂机端可以是手机 App / 云手机, 只要能访问本站即可 = 支持云端挂机。
 *   轮询: GET /app/vmq/task?key=&type=      -> {code:1, trade_no, price}
 *   推送: GET/POST /app/vmq/push?key=&trade_no=&price=&type=
 * 免挂机场景请用 bepusdt / xorpay / epay 渠道。
 */
export const vmqPlugin: ChannelPlugin = {
  id: 'vmq',
  name: 'V免签挂机(需App监听)',
  types: ['alipay', 'wxpay'],
  inputs: [
    { name: 'key', label: '通信密钥(挂机端配置)', required: true },
    { name: 'qrcode_alipay', label: '支付宝收款码图片链接' },
    { name: 'qrcode_wxpay', label: '微信收款码图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开, 同原版金额递增)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = ctx.channel.config;
    const qr = ctx.payType === 'wxpay' ? cfg.qrcode_wxpay : cfg.qrcode_alipay;
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, cfg.pay_suffix !== '0');
    return { ok: true, qrContent: qr || '', payAmount };
  },
};

/** 挂机端取单: 返回该支付类型下最早的待支付订单 */
export async function vmqTask(env: Bindings, key: string, type: string): Promise<Response> {
  const cfg = await env.DB.prepare(
    "SELECT config FROM channels WHERE plugin='vmq' AND status=1"
  ).all<{ config: string }>();
  let valid = false;
  for (const row of cfg.results || []) {
    try {
      if (JSON.parse(row.config).key === key) valid = true;
    } catch {}
  }
  if (!valid) return Response.json({ code: -1, msg: 'key错误' });
  const typeFilter = type === 'wxpay' ? 'wxpay' : 'alipay';
  const order = await env.DB.prepare(
    "SELECT trade_no, money, ext FROM orders WHERE status=0 AND type=? AND channel IN (SELECT id FROM channels WHERE plugin='vmq') ORDER BY id ASC LIMIT 1"
  )
    .bind(typeFilter)
    .first<{ trade_no: string; money: number; ext: string }>();
  if (!order) return Response.json({ code: 0, msg: '暂无订单' });
  let pay = cents2str(order.money);
  try {
    const ext = JSON.parse(order.ext || '{}');
    if (ext.pay_amount) pay = String(ext.pay_amount);
  } catch {}
  return Response.json({ code: 1, trade_no: order.trade_no, price: pay });
}

/** 挂机端推送到账: 金额必须与订单一致才放行 */
export async function vmqPush(
  env: Bindings,
  key: string,
  tradeNo: string,
  price: string
): Promise<{ ok: boolean; respond: string }> {
  const rows = await env.DB.prepare("SELECT id, config FROM channels WHERE plugin='vmq' AND status=1").all<{
    id: number;
    config: string;
  }>();
  let valid = false;
  for (const row of rows.results || []) {
    try {
      if (JSON.parse(row.config).key === key) valid = true;
    } catch {}
  }
  if (!valid) return { ok: false, respond: 'key错误' };
  const order = await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(tradeNo).first<{
    trade_no: string;
    money: number;
    status: number;
    channel: number;
    ext: string;
  }>();
  if (!order) return { ok: false, respond: '订单不存在' };
  if (order.status !== 0) return { ok: true, respond: 'success' }; // 幂等
  let expect = order.money;
  try {
    const ext = JSON.parse((order as unknown as { ext?: string }).ext || '{}');
    if (ext.pay_amount) expect = str2cents(String(ext.pay_amount));
  } catch {}
  if (str2cents(price) !== expect) return { ok: false, respond: '金额不匹配' };
  const paid = await markOrderPaid(env, tradeNo, order.money, 'VMQ' + now());
  if (paid) {
    const full = await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(tradeNo).first<OrderRow>();
    if (full) await sendMerchantNotifySafe(env, full);
  }
  return { ok: paid, respond: paid ? 'success' : '处理失败' };
}
