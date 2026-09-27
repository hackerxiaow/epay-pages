import { ChannelCtx, ChannelPlugin } from '../channel';
import { ensurePayAmount, BillChannelConfig } from '../billpoll';

/**
 * QQ钱包个人码账单轮询 —— 二开码支付"QQ免挂"同款原理:
 * 云端定时轮询 QQ钱包账单接口(需提供账单页Cookie), 金额尾数匹配自动确认。
 * 另可配合 OneBot协议端(NapCat等) 上报, 见 /onebot/report。
 */
export const qqBillPlugin: ChannelPlugin = {
  id: 'qqbill',
  name: 'QQ钱包个人码(账单轮询·免挂)',
  types: ['qqpay'],
  inputs: [
    { name: 'cookie', label: 'QQ钱包账单页Cookie(抓包获取)', required: true, multiline: true },
    { name: 'bill_url', label: 'QQ钱包账单接口地址(抓包获取)', required: true },
    { name: 'qrcode_qqpay', label: 'QQ收款码图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = JSON.parse(JSON.stringify(ctx.channel.config)) as BillChannelConfig;
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, cfg.pay_suffix !== '0');
    return { ok: true, qrContent: cfg.qrcode_qqpay || cfg.qrcode || '', payAmount };
  },
};
