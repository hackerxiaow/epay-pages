import { md5 } from '../sign';
import { randomStr } from '../util';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult } from '../channel';

export interface WxPayConfig {
  appid: string;
  mchid: string;
  key: string; // 商户API密钥(V2)
  api_base?: string; // 默认 https://api.mch.weixin.qq.com (可覆盖便于测试)
  paymin?: string;
  paymax?: string;
}

/** V2 协议: k=v& 排序 + &key=KEY, MD5 大写 */
function wxSign(params: Record<string, string>, key: string): string {
  const str = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return md5(str + '&key=' + key).toUpperCase();
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toXml(params: Record<string, string>): string {
  return (
    '<xml>' +
    Object.keys(params)
      .map((k) => `<${k}><![CDATA[${params[k]}]]></${k}>`)
      .join('') +
    '</xml>'
  );
}

function parseXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cdata = /<([a-zA-Z0-9_]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = cdata.exec(xml))) out[m[1]] = m[2];
  if (Object.keys(out).length === 0) {
    const plain = /<([a-zA-Z0-9_]+)>([^<]+)<\/\1>/g;
    while ((m = plain.exec(xml))) out[m[1]] = m[2];
  }
  return out;
}

export function parseWxConfig(raw: string): WxPayConfig {
  return JSON.parse(raw || '{}') as WxPayConfig;
}

/** 微信扫码支付 Native (V2 unifiedorder, MD5) */
export const wxpayNativePlugin: ChannelPlugin = {
  id: 'wxpaynative',
  name: '微信扫码支付(官方V2)',
  types: ['wxpay'],
  inputs: [
    { name: 'appid', label: '公众号/应用 AppID', required: true },
    { name: 'mchid', label: '微信支付商户号', required: true },
    { name: 'key', label: '商户API密钥(32位)', required: true },
    { name: 'api_base', label: 'API地址(留空用官方, 测试可覆盖)' },
    { name: 'paymin', label: '单笔最低(元)' },
    { name: 'paymax', label: '单笔最高(元)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = parseWxConfig(JSON.stringify(ctx.channel.config));
    if (!cfg.appid || !cfg.mchid || !cfg.key) return { ok: false, msg: '渠道配置不完整' };
    const params: Record<string, string> = {
      appid: cfg.appid,
      mch_id: cfg.mchid,
      nonce_str: randomStr(32),
      body: (ctx.order.name || '订单').slice(0, 60),
      out_trade_no: ctx.order.trade_no,
      total_fee: String(ctx.order.money),
      spbill_create_ip: ctx.order.ip || '127.0.0.1',
      notify_url: `${ctx.siteUrl}/channel/notify/wxpaynative/${ctx.channel.id}`,
      trade_type: 'NATIVE',
    };
    params.sign = wxSign(params, cfg.key);
    const base = (cfg.api_base || 'https://api.mch.weixin.qq.com').replace(/\/+$/, '');
    let resp: Response;
    try {
      resp = await fetch(`${base}/pay/unifiedorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: toXml(params),
      });
    } catch {
      return { ok: false, msg: '微信支付连接失败' };
    }
    const data = parseXml(await resp.text());
    if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
      return { ok: false, msg: String(data.err_code_des || data.return_msg || '微信下单失败') };
    }
    // 校验响应签名
    const expect = wxSign(data, cfg.key);
    if (data.sign && expect !== data.sign) return { ok: false, msg: '微信响应验签失败' };
    const codeUrl = data.code_url || '';
    if (!codeUrl) return { ok: false, msg: '微信未返回二维码链接' };
    return { ok: true, qrContent: codeUrl };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const cfg = parseWxConfig(JSON.stringify(ctx.channel.config));
    const xml = await ctx.req.text();
    const data = parseXml(xml);
    const expect = wxSign(data, cfg.key);
    if (!data.sign || expect !== data.sign) return { ok: false, respond: '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[sign error]]></return_msg></xml>' };
    if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
      return { ok: false, respond: '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>' };
    }
    return {
      ok: true,
      respond: '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>',
      tradeNo: data.out_trade_no,
      money: parseInt(data.total_fee || '0', 10),
      apiTradeNo: data.transaction_id || '',
    };
  },
};
