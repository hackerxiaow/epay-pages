import { md5 } from '../sign';
import { cents2str, str2cents } from '../util';
import { ChannelCtx, ChannelPlugin, NotifyCtx, NotifyResult } from '../channel';

/**
 * BEpusdt — 开源加密货币收款网关(USDT/TRC20 等), 纯 API 免挂机, 链上确认即到账
 * 协议: https://github.com/v03413/BEpusdt/blob/main/docs/api/api.md
 * config: url 服务地址, auth API 对接令牌, trade_type 收款网络, fiat 计价法币
 *
 * 签名规则(下单与回调一致): 剔除空值与 signature, 参数名按 ASCII 升序拼 `k=v&`,
 * 末尾直接追加令牌后 MD5 取小写。
 */
export function bepusdtSign(params: Record<string, unknown>, token: string): string {
  const raw = Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return md5(raw + token);
}

/** 回调参数一律转字符串: 数字不能带 JSON 引号, 否则和上游算出的签名对不上 */
function toStr(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

export const bepusdtPlugin: ChannelPlugin = {
  id: 'bepusdt',
  name: 'BEpusdt(加密货币)',
  types: ['usdt'],
  inputs: [
    {
      name: 'url',
      label: 'BEpusdt 服务地址',
      required: true,
      placeholder: 'https://pay.你的域名.com',
      hint: '你自己部署的 BEpusdt 站点地址，带 https://，结尾不要加斜杠',
    },
    {
      name: 'auth',
      label: 'API 对接令牌 (Auth Key)',
      required: true,
      multiline: true,
      hint: 'BEpusdt 后台 → 系统管理 → 基本设置 → API 设置 → 对接令牌',
    },
    {
      name: 'trade_type',
      label: '收款网络 (可留空)',
      placeholder: 'usdt.trc20',
      hint: '留空 = usdt.trc20(TRC20)。也可填 usdt.erc20 / tron.trx / usdc.polygon 等',
    },
    {
      name: 'fiat',
      label: '计价法币 (可留空)',
      placeholder: 'CNY',
      hint: '留空 = CNY，本站按人民币金额提交，由上游按实时汇率折算成币',
    },
  ],
  help: [
    'BEpusdt 是开源加密货币收款网关，需要自己部署一份（没有公共服务器能直接借用）。',
    '① 部署：服务器执行 <code>docker run -d --name bepusdt -p 8000:8000 -v /root/bepusdt:/data v03413/bepusdt:latest</code>',
    '② 打开 <code>http://服务器IP:8000</code> 初始化管理员，在「钱包管理」里添加你的收款地址（TRC20 等）。',
    '③ 进「系统管理 → 基本设置 → API 设置」，复制「对接令牌」填到上面的 Auth Key。',
    '④ 有域名/HTTPS 就把域名填进「服务地址」；买家付 USDT、链上确认后本站自动到账，无需挂机。',
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = ctx.channel.config;
    const base = (cfg.url || '').trim().replace(/\/+$/, '');
    const auth = (cfg.auth || '').trim();
    if (!base || !auth) return { ok: false, msg: '渠道配置不完整: 需填 BEpusdt 服务地址与 API 对接令牌' };

    const params: Record<string, unknown> = {
      order_id: ctx.order.trade_no,
      amount: Number(cents2str(ctx.order.money)),
      notify_url: `${ctx.siteUrl}/channel/notify/bepusdt/${ctx.channel.id}`,
      redirect_url: `${ctx.siteUrl}/payok/${ctx.order.trade_no}`,
      fiat: (cfg.fiat || 'CNY').trim().toUpperCase(),
      trade_type: (cfg.trade_type || 'usdt.trc20').trim(),
    };
    if (ctx.order.name) params.name = ctx.order.name;
    params.signature = bepusdtSign(params, auth);

    let resp: Response;
    try {
      resp = await fetch(`${base}/api/v1/order/create-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch {
      return { ok: false, msg: 'BEpusdt 连接失败, 请检查服务地址是否可访问' };
    }
    const data = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) return { ok: false, msg: 'BEpusdt 返回了非 JSON 响应, 请确认服务地址填的是 BEpusdt 站点' };
    if (Number(data.status_code) !== 200) return { ok: false, msg: String(data.message || 'BEpusdt 下单失败') };

    const d = (data.data || {}) as Record<string, unknown>;
    const link = String(d.payment_url || '');
    if (!link) return { ok: false, msg: 'BEpusdt 未返回收银台地址' };
    // 官方收银台自带金额/地址/倒计时, 直接跳转; 同时作为二维码内容供接口与码牌模式使用
    return { ok: true, payUrl: link, qrContent: link };
  },

  async onNotify(ctx: NotifyCtx): Promise<NotifyResult> {
    const auth = ctx.channel.config.auth;
    const params: Record<string, string> = {};
    const ct = ctx.req.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const j = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
      for (const k of Object.keys(j)) params[k] = toStr(j[k]);
    } else {
      const form = await ctx.req.formData().catch(() => new FormData());
      form.forEach((v, k) => (params[k] = toStr(v)));
    }
    // 新版 BEpusdt 用 signature, 旧版 epusdt 插件协议用 sign, 两个名字都认
    const sign = params.signature || params.sign || '';
    delete params.signature;
    delete params.sign;
    if (!sign || bepusdtSign(params, auth) !== sign) return { ok: false, respond: 'sign error' };

    // status: 1 等待支付 / 2 支付成功 / 3 支付超时。非成功状态回 success 让上游停止重推, 但本站不记账
    if (Number(params.status) !== 2) return { ok: true, respond: 'success' };

    return {
      ok: true,
      respond: 'success',
      tradeNo: params.order_id || params.trade_id,
      money: str2cents(params.amount || ''),
      apiTradeNo: params.trade_id || params.block_transaction_id || '',
    };
  },
};
