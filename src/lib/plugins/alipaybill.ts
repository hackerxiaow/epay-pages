import { ChannelCtx, ChannelPlugin } from '../channel';
import { ensurePayAmount, BillChannelConfig } from '../billpoll';

/** 支付宝个人码账单轮询: 免CK(开放平台官方API) / Cookie 双数据源 */
export const alipayBillPlugin: ChannelPlugin = {
  id: 'alipaybill',
  name: '支付宝个人码(账单轮询·免挂机/免CK)',
  types: ['alipay'],
  inputs: [
    { name: 'appid', label: '开放平台APPID(20开头, 填了即免CK模式, 推荐)', required: false },
    { name: 'private_key', label: '应用私钥(免CK模式)', multiline: true },
    { name: 'alipay_public_key', label: '支付宝公钥(免CK模式)', multiline: true },
    { name: 'gateway', label: '网关(留空用官方, 测试可覆盖)' },
    { name: 'cookie', label: '网页Cookie(旧方案, 免CK不填)' },
    { name: 'bill_url', label: 'Cookie模式账单接口地址(留空用默认)' },
    { name: 'user_id', label: '支付宝用户ID(PID, 2088开头, 用于免输金额转账)' },
    { name: 'qrcode_alipay', label: '个人收款码图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = JSON.parse(JSON.stringify(ctx.channel.config)) as BillChannelConfig;
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, cfg.pay_suffix !== '0');
    let transferUrl = '';
    if (cfg.user_id) {
      transferUrl = `alipays://platformapi/startapp?appId=20000123&actionType=toAccount&userId=${encodeURIComponent(cfg.user_id)}&amount=${encodeURIComponent(payAmount)}&memo=${encodeURIComponent(ctx.order.trade_no)}`;
    }
    return { ok: true, qrContent: cfg.qrcode_alipay || '', payAmount, transferUrl };
  },
};
