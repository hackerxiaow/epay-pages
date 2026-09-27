import { buildSign, verifySign } from '../sign';
import { cents2str, str2cents } from '../util';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult, getExternalOrigin } from '../channel';

export const epayPlugin: ChannelPlugin = {
  id: 'epay',
  name: '易支付上游',
  types: ['alipay', 'wxpay', 'qqpay', 'usdt'],
  inputs: [
    { name: 'url', label: '上游地址(含 http)', required: true },
    { name: 'pid', label: '上游商户ID', required: true },
    { name: 'key', label: '上游商户密钥', required: true },
  ],

  async createOrder(ctx: ChannelCtx) {
    const { url, pid, key } = ctx.channel.config;
    if (!url || !pid || !key) return { ok: false, msg: '渠道配置不完整' };
    const notifyUrl = `${ctx.siteUrl}/channel/notify/epay/${ctx.channel.id}`;
    const returnUrl = `${ctx.siteUrl}/payok/${ctx.order.trade_no}`;
    const params: Record<string, string> = {
      pid,
      type: ctx.payType === 'usdt' ? 'alipay' : ctx.payType, // 不支持 usdt 的上游映射到支付宝
      out_trade_no: ctx.order.trade_no,
      notify_url: notifyUrl,
      return_url: returnUrl,
      name: ctx.order.name || '订单',
      money: cents2str(ctx.order.money),
    };
    const sign = buildSign(params, key);
    const body = new URLSearchParams({ ...params, sign, sign_type: 'MD5' });
    const base = url.replace(/\/+$/, '');
    let resp: Response;
    try {
      resp = await fetch(`${base}/mapi.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      return { ok: false, msg: '上游连接失败' };
    }
    const text = await resp.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, msg: '上游返回异常: ' + text.slice(0, 120) };
    }
    if (data.code !== 1) return { ok: false, msg: String(data.msg || '上游下单失败') };
    const payUrl = String(data.payurl || data.url || '');
    const qr = String(data.qrcode || data.img || '');
    return { ok: true, payUrl: payUrl || undefined, qrContent: qr || undefined };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const url = ctx.url;
    const key = ctx.channel.config.key;
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (!verifySign(params, key, params.sign)) {
      return { ok: false, respond: 'sign error' };
    }
    if (params.trade_status !== 'TRADE_SUCCESS') {
      return { ok: false, respond: 'ignore' };
    }
    return {
      ok: true,
      respond: 'success',
      tradeNo: params.out_trade_no,
      money: str2cents(params.money),
      apiTradeNo: params.trade_no || '',
    };
  },
};
