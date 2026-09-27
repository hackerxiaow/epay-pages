import { buildSignString } from '../sign';
import { cents2str, now, randomStr } from '../util';
import { rsaSign, rsaVerify } from '../rsa';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult, RefundCtx } from '../channel';

export interface AlipayConfig {
  appid: string;
  private_key: string; // 应用私钥 PKCS8 PEM
  alipay_public_key: string; // 支付宝公钥 PEM
  gateway?: string; // 默认 https://openapi.alipay.com/gateway.do (可覆盖便于测试)
  enable_transfer?: string; // '1' 启用自动打款
}

async function alipayRequest(
  cfg: AlipayConfig,
  method: string,
  bizContent: Record<string, unknown>,
  notifyUrl?: string
): Promise<{ code: string; msg: string; sub?: string; data?: Record<string, unknown> }> {
  const params: Record<string, string> = {
    app_id: cfg.appid,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
  };
  if (notifyUrl) params.notify_url = notifyUrl;
  const sign = await rsaSign(cfg.private_key, buildSignString(params));
  const body = new URLSearchParams({ ...params, sign }).toString();
  const resp = await fetch(cfg.gateway || 'https://openapi.alipay.com/gateway.do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  const key = Object.keys(data).find((k) => k === method.replace(/\./g, '_') + '_response') || '';
  const inner = (key ? data[key] : {}) as Record<string, unknown>;
  const code = String(inner.code || '');
  const msg = String(inner.sub_msg || inner.msg || '支付宝请求失败');
  if (code !== '10000') return { code, msg };
  // 验证响应签名
  const respSign = String((data as Record<string, unknown>).sign || '');
  const raw = JSON.stringify(inner);
  if (respSign && !(await rsaVerify(cfg.alipay_public_key, raw, respSign))) {
    return { code: '-1', msg: '支付宝响应验签失败' };
  }
  return { code: '10000', msg: 'ok', data: inner };
}

function alipayTimestamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function parseAlipayConfig(raw: string): AlipayConfig {
  const cfg = JSON.parse(raw || '{}') as AlipayConfig;
  return cfg;
}

/** 当面付预下单插件 */
export const alipayF2fPlugin: ChannelPlugin = {
  id: 'alipayf2f',
  name: '支付宝当面付(官方)',
  types: ['alipay'],
  inputs: [
    { name: 'appid', label: '支付宝应用APPID', required: true },
    { name: 'private_key', label: '应用私钥(PKCS8 PEM)', required: true, multiline: true },
    { name: 'alipay_public_key', label: '支付宝公钥(PEM)', required: true, multiline: true },
    { name: 'gateway', label: '网关(留空用官方, 测试可覆盖)' },
    { name: 'enable_transfer', label: '启用自动打款(1开)' },
    { name: 'paymin', label: '单笔最低(元)' },
    { name: 'paymax', label: '单笔最高(元)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = parseAlipayConfig(JSON.stringify(ctx.channel.config));
    const r = await alipayRequest(
      cfg,
      'alipay.trade.pre.create',
      {
        out_trade_no: ctx.order.trade_no,
        total_amount: cents2str(ctx.order.money),
        subject: ctx.order.name || '订单',
      },
      `${ctx.siteUrl}/channel/notify/alipayf2f/${ctx.channel.id}`
    );
    if (r.code !== '10000') return { ok: false, msg: r.msg };
    const qr = String(r.data?.qr_code || '');
    if (!qr) return { ok: false, msg: '支付宝未返回二维码' };
    return { ok: true, qrContent: qr };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const cfg = parseAlipayConfig(JSON.stringify(ctx.channel.config));
    const form: Record<string, string> = {};
    try {
      const fd = await ctx.req.formData();
      fd.forEach((v, k) => (form[k] = String(v)));
    } catch {
      ctx.url.searchParams.forEach((v, k) => (form[k] = v));
    }
    const sign = form.sign;
    const str = buildSignString(form);
    if (!(await rsaVerify(cfg.alipay_public_key, str, sign))) return { ok: false, respond: 'sign error' };
    if (form.trade_status !== 'TRADE_SUCCESS' && form.trade_status !== 'TRADE_FINISHED') {
      return { ok: false, respond: 'ignore' };
    }
    return {
      ok: true,
      respond: 'success',
      tradeNo: form.out_trade_no,
      money: Math.round(Number(form.total_amount || 0) * 100),
      apiTradeNo: form.trade_no || '',
    };
  },
};

/** 结算自动打款: 支付宝单笔转账到支付宝账户 */
export async function alipayTransfer(
  cfgRaw: string,
  outBizNo: string,
  amountYuan: string,
  account: string,
  realName: string,
  remark: string
): Promise<{ ok: boolean; msg: string; orderNo?: string }> {
  const cfg = parseAlipayConfig(cfgRaw);
  const r = await alipayRequest(cfg, 'alipay.fund.trans.uni.transfer', {
    out_biz_no: outBizNo,
    trans_amount: amountYuan,
    product_code: 'TRANS_ACCOUNT_NO_PWD',
    biz_scene: 'DIRECT_TRANSFER',
    remark: remark || '结算打款',
    payee_info: { identity: account, identity_type: 'ALIPAY_LOGON_ID', name: realName || undefined },
  });
  if (r.code !== '10000') return { ok: false, msg: r.msg };
  return { ok: true, msg: 'ok', orderNo: String(r.data?.order_id || '') };
}

export const ALIPAY_TRANSFER_NO = () => 'ST' + now() + randomStr(6);
