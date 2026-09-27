import { md5 } from '../sign';
import { cents2str } from '../util';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult } from '../channel';

/**
 * BEpusdt (USDT TRC20 收款, 开源) 插件 — 纯 API, 免挂机, 链上确认即到账
 * config: url 服务地址, auth 通信密钥
 */
export const bepusdtPlugin: ChannelPlugin = {
  id: 'bepusdt',
  name: 'BEpusdt(USDT)',
  types: ['usdt'],
  inputs: [
    { name: 'url', label: 'BEPusdt 服务地址', required: true },
    { name: 'auth', label: 'Auth Key', required: true },
  ],

  async createOrder(ctx: ChannelCtx) {
    const { url, auth } = ctx.channel.config;
    if (!url || !auth) return { ok: false, msg: '渠道配置不完整' };
    const base = url.replace(/\/+$/, '');
    const body = JSON.stringify({
      trade_id: ctx.order.trade_no,
      amount: Number(cents2str(ctx.order.money)),
      order_id: ctx.order.trade_no,
      notify_url: `${ctx.siteUrl}/channel/notify/bepusdt/${ctx.channel.id}`,
      redirect_url: `${ctx.siteUrl}/payok/${ctx.order.trade_no}`,
      client_ip: ctx.order.ip || '',
    });
    let resp: Response;
    try {
      resp = await fetch(`${base}/api/v1/order/create-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        body,
      });
    } catch {
      return { ok: false, msg: 'BEPusdt 连接失败' };
    }
    const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || (data.code !== 200 && data.code !== 0)) {
      return { ok: false, msg: String(data?.msg || 'BEPusdt 下单失败') };
    }
    const d = (data.data || {}) as Record<string, unknown>;
    const link = String(d.payment_link || d.pay_url || d.trade_type || '');
    if (!link) return { ok: false, msg: 'BEPusdt 未返回支付链接' };
    return { ok: true, qrContent: link };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const auth = ctx.channel.config.auth;
    let params: Record<string, string> = {};
    const ct = ctx.req.headers.get('Content-Type') || '';
    if (ct.includes('json')) {
      const j = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
      for (const k of Object.keys(j)) params[k] = String(j[k]);
    } else {
      const form = await ctx.req.formData().catch(() => new FormData());
      form.forEach((v, k) => (params[k] = String(v)));
    }
    const sign = params.sign;
    const filtered = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== undefined)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    if (md5(filtered + auth) !== sign) return { ok: false, respond: 'sign error' };
    const paid = params.status === '1' || params.status === 'paid' || params.trade_status === 'TRADE_SUCCESS';
    if (!paid) return { ok: false, respond: 'ignore' };
    return {
      ok: true,
      respond: 'success',
      tradeNo: params.order_id || params.trade_id,
      money: Math.round(Number(params.amount || params.actual_amount || 0) * 100),
      apiTradeNo: params.trade_id || '',
    };
  },
};
