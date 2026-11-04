import { cfgGet, channelByIds } from './repo';

/**
 * 渠道路由: channel_map[type] 支持
 *   数字        单渠道
 *   "1,2,3"     多渠道按 weight 加权随机轮询
 *   [{...}]     数组形式 ID 列表
 * 渠道自身可配置 paymin / paymax (元) 过滤金额
 */
export async function resolveChannel(
  payType: string,
  money: number
): Promise<{ ok: boolean; channelId?: number; msg?: string }> {
  const raw = await cfgGet('channel_map');  let map: Record<string, unknown> = {};
  try {
    map = JSON.parse(raw || '{}');
  } catch {}
  const val = map[payType];
  let ids: number[] = [];
  if (typeof val === 'number') ids = [val];
  else if (Array.isArray(val)) ids = val.map((x) => Number(x)).filter(Boolean);
  else if (typeof val === 'string' && val.trim())
    ids = val.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  if (!ids.length) return { ok: false, msg: `支付方式 ${payType} 未配置通道` };

  // 原 SQL: SELECT * FROM channels WHERE id IN (...) AND status=1
  const results = await channelByIds(ids, true);

  const eligible = (results || []).filter((ch) => {
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(ch.config || '{}');
    } catch {}

    const isCrypto = ch.plugin === 'tronusdt' || ch.plugin === 'bepusdt' || payType === 'usdt';
    if (isCrypto) {
      // 加密货币渠道: paymin / paymax 按 USDT 计价
      const rate = parseFloat(cfg.rate || '') || 7.30;
      const orderUsdt = (money / 100) / rate;
      const paymin = parseFloat(cfg.paymin || '0');
      const paymax = parseFloat(cfg.paymax || '0');
      // 允许设置如 0.1 USDT 最低限额
      if (paymin > 0 && orderUsdt < paymin - 0.0001) return false;
      if (paymax > 0 && orderUsdt > paymax + 0.0001) return false;
      return true;
    }

    // 法币普通渠道 (微信/支付宝/QQ等): paymin / paymax 按人民币元计价
    const paymin = Math.round(Number(cfg.paymin || 0) * 100);
    const paymax = Math.round(Number(cfg.paymax || 0) * 100);
    if (paymin && money < paymin) return false;
    if (paymax && money > paymax) return false;
    return true;
  });
  if (!eligible.length) return { ok: false, msg: '支付通道不可用或金额不在支持范围' };

  // 加权随机
  const weights = eligible.map((c) => Math.max(1, c.weight || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return { ok: true, channelId: eligible[i].id };
  }
  return { ok: true, channelId: eligible[eligible.length - 1].id };
}

/** IP 黑名单: 精确匹配或前缀匹配(如 "10.0.") */
export function isBlacklisted(blacklist: string, ip: string): boolean {
  if (!blacklist || !ip) return false;
  return blacklist
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => (entry.endsWith('.') ? ip.startsWith(entry) : ip === entry));
}
