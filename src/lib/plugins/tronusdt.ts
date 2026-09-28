import { ChannelCtx, ChannelPlugin } from '../channel';
import { ensureTronUsdtAmount, TronChannelConfig } from '../tronusdt';
import { cents2str, now } from '../util';

/**
 * 原生 USDT (TRC20) 链上对账插件 — 纯边缘函数直连波场 RPC
 * 零服务器、零 Docker、零挂机软件、零三方抽成
 */
export const tronUsdtPlugin: ChannelPlugin = {
  id: 'tronusdt',
  name: '原生USDT(TRC20链上查账·零服务器免挂)',
  types: ['usdt'],
  inputs: [
    {
      name: 'address',
      label: 'TRC20 收款钱包地址',
      required: true,
      placeholder: 'T 开头的波场钱包地址 (交易所充币地址或冷/热钱包均可)',
      hint: '你的 TRC20 收款地址。资金直接到你的钱包，无任何中间商。',
    },
    {
      name: 'rate',
      label: 'USDT/CNY 汇率设置',
      placeholder: 'auto 或固定数字 (如 7.30)',
      hint: '留空或填 auto = 自动拉取实时行情；也可以填固定汇率如 7.35。',
    },
    {
      name: 'timeout',
      label: '订单有效期 (分钟)',
      placeholder: '15',
      hint: '默认 15 分钟。超时未付款将释放该笔防撞单微尾数。',
    },
    {
      name: 'trongrid_key',
      label: 'TronGrid API Key (可选)',
      placeholder: '留空使用公共官方节点',
      hint: '可选。去 trongrid.io 免费注册申请，可提高查链并发上限。',
    },
    {
      name: 'api_base',
      label: '自定义 API 节点 (仅测试/专线用, 留空默认)',
      placeholder: '留空默认使用官方节点',
    },
  ],
  help: [
    '这是纯内置的原生链上查账引擎，运行在 Cloudflare 全球边缘节点上，不需要搭建任何服务器，也不需要运行挂机软件！',
    '① 你只需提供一个波场钱包地址（T开头，支持 imToken、TronLink、OKX Web3 钱包，或者各大交易所的 TRC20 充币地址）。',
    '② 买家在收银台会看到带微尾数的精确转账金额（例如 13.6942 USDT）和你的收款地址。',
    '③ 买家转账后，边缘函数直连波场节点监听入账，链上出块确认后（通常 5~15 秒）自动到账并回调商户！',
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = JSON.parse(JSON.stringify(ctx.channel.config)) as TronChannelConfig;
    const addr = (cfg.address || '').trim();
    if (!addr || !addr.startsWith('T') || addr.length < 30) {
      return { ok: false, msg: 'TRC20 钱包地址不合法 (波场主网地址必须以字母 T 开头)' };
    }

    const tronExt = await ensureTronUsdtAmount(ctx.env, ctx.order, cfg);
    const expireSec = Math.max(0, tronExt.expire_at - now());

    // 二维码内容: 优先使用波场标准转账 URI (钱包App扫码可直接带出地址与金额)
    const qrContent = `tron:${tronExt.wallet}?amount=${tronExt.pay_usdt}`;

    return {
      ok: true,
      qrContent,
      payAmount: cents2str(ctx.order.money),
      coinAmount: `${tronExt.pay_usdt} USDT`,
      coinRate: `1 USDT ≈ ${tronExt.rate} CNY`,
      walletAddress: tronExt.wallet,
      expireSeconds: expireSec,
    };
  },
};
