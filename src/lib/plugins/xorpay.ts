import { md5 } from '../sign';
import { cents2str, str2cents } from '../util';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult } from '../channel';

/**
 * XorPay 聚合收款 — 免挂机 (官方代收, 个人可用), T+1 结算到绑卡
 * 文档: https://xorpay.com/doc  config: appid, secret
 */
export const xorpayPlugin: ChannelPlugin = {
  id: 'xorpay',
  name: 'XorPay(免挂机聚合)',
  types: ['alipay', 'wxpay'],
  inputs: [
    { name: 'appid', label: 'AppID', required: true },
    { name: 'secret', label: 'AppSecret', required: true },
    { name: 'shopname', label: '商店名' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const { appid, secret, shopname } = ctx.channel.config;
    if (!appid || !secret) return { ok: false, msg: '渠道配置不完整' };
    const payType = ctx.payType === 'wxpay' ? 'wxpay' : 'alipay';
    const name = (ctx.order.name || shopname || '订单').slice(0, 30);
    const price = cents2str(ctx.order.money);
    const outTradeNo = ctx.order.trade_no;
    const callbackUrl = `${ctx.siteUrl}/channel/notify/xorpay/${ctx.channel.id}`;
    const notifyUrl = `${ctx.siteUrl}/channel/notify/xorpay/${ctx.channel.id}`;
    const sign = md5(`${name}${payType}${price}${outTradeNo}${callbackUrl}${secret}`);
    let resp: Response;
    try {
      resp = await fetch('https://pay.xorpay.com/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          pay_type: payType,
          price,
          out_trade_no: outTradeNo,
          notify_url: notifyUrl,
          callback_url: callbackUrl,
          app_id: appid,
          sign,
        }),
      });
    } catch {
      return { ok: false, msg: 'XorPay 连接失败' };
    }
    const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || data.code !== 1) return { ok: false, msg: String(data?.msg || 'XorPay 下单失败') };
    const d = (data.data || {}) as Record<string, unknown>;
    return {
      ok: true,
      payUrl: String(d.pay_url || '') || undefined,
      qrContent: String(d.qr_img || '') || undefined,
    };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const secret = ctx.channel.config.secret;
    const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
    const p: Record<string, string> = {};
    for (const k of Object.keys(body)) p[k] = String(body[k]);
    // xorpay: hash = md5(pay_price + out_trade_no + order_id + secret)
    const hash = md5(`${p.pay_price}${p.out_trade_no}${p.order_id}${secret}`);
    if (hash !== p.hash) return { ok: false, respond: 'sign error' };
    if (p.status !== 'success') return { ok: false, respond: 'ignore' };
    return {
      ok: true,
      respond: 'success',
      tradeNo: p.out_trade_no,
      money: str2cents(p.pay_price),
      apiTradeNo: p.order_id || '',
    };
  },
};
