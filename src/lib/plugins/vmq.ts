import { md5 } from '../sign';
import { cents2str, now, str2cents } from '../util';
import { Bindings } from '../auth';
import { ChannelCtx, ChannelPlugin, NotifyResult } from '../channel';
import { markOrderPaid, sendMerchantNotifySafe } from '../orderflow';
import { OrderRow } from '../db';
import { ensurePayAmount } from '../billpoll';
import { channelByPlugin, orderByTradeNo, orderListPending } from '../repo';

/**
 * V免签 (VMQ) 兼容协议: 挂机端 App 轮询取单 + 推送到账。
 * 挂机端可以是手机 App / 云手机, 只要能访问本站即可 = 支持云端挂机。
 *   轮询: GET /app/vmq/task?key=&type=      -> {code:1, trade_no, price}
 *   推送: GET/POST /app/vmq/push?key=&trade_no=&price=&type=
 * 免挂机场景请用 bepusdt / xorpay / epay 渠道。
 */
export const vmqPlugin: ChannelPlugin = {
  id: 'vmq',
  name: 'V免签挂机(多端监听:安卓/桌面/二开版)',
  types: ['alipay', 'wxpay', 'qqpay', 'usdt'],
  inputs: [
    { name: 'key', label: '通信密钥(挂机端配置)', required: true },
    { name: 'qrcode_alipay', label: '支付宝收款码图片链接' },
    { name: 'qrcode_wxpay', label: '微信收款码图片链接' },
    { name: 'qrcode_qqpay', label: 'QQ收款码图片链接' },
    { name: 'qrcode_usdt', label: 'USDT钱包二维码内容/图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开, 同原版金额递增)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = ctx.channel.config;
    const qrMap: Record<string, string | undefined> = {
      alipay: cfg.qrcode_alipay,
      wxpay: cfg.qrcode_wxpay,
      qqpay: cfg.qrcode_qqpay,
      usdt: cfg.qrcode_usdt,
    };
    const qr = qrMap[ctx.payType] || '';
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, cfg.pay_suffix !== '0');
    return { ok: true, qrContent: qr || '', payAmount };
  },
};

/** 挂机端取单: 返回该支付类型下最早的待支付订单 */
export async function vmqTask(env: Bindings, key: string, type: string): Promise<Response> {
  const cfg = await channelByPlugin('vmq', true);
  let valid = false;
  for (const row of cfg) {
    try {
      if (JSON.parse(row.config).key === key) valid = true;
    } catch {}
  }
  if (!valid) return Response.json({ code: -1, msg: 'key错误' });
  const typeFilter = ['alipay', 'wxpay', 'qqpay', 'usdt'].includes(type) ? type : 'alipay';
  // 原 SQL 是 status=0 + type + 渠道属于 vmq 插件，ORDER BY id ASC LIMIT 1
  const [order] = await orderListPending({
    type: typeFilter,
    channelIds: cfg.map((c) => c.id),
    order: 'asc',
    limit: 1,
  });
  if (!order) return Response.json({ code: 0, msg: '暂无订单' });
  const pay = order.pay_amount ? String(order.pay_amount) : cents2str(order.money);
  return Response.json({ code: 1, trade_no: order.trade_no, price: pay });
}

/** 挂机端推送到账: 金额必须与订单一致才放行 */
export async function vmqPush(
  env: Bindings,
  key: string,
  tradeNo: string,
  price: string
): Promise<{ ok: boolean; respond: string }> {
  const rows = await channelByPlugin('vmq', true);
  let valid = false;
  for (const row of rows) {
    try {
      if (JSON.parse(row.config).key === key) valid = true;
    } catch {}
  }
  if (!valid) return { ok: false, respond: 'key错误' };
  const order = await orderByTradeNo(tradeNo);
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
    const full = await orderByTradeNo(tradeNo);
    if (full) await sendMerchantNotifySafe(env, full);
  }
  return { ok: paid, respond: paid ? 'success' : '处理失败' };
}
