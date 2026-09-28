import { Bindings } from './auth';
import { markOrderPaid, OrderRow } from './db';
import { sendMerchantNotifySafe } from './orderflow';
import { now } from './util';

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const DEFAULT_USDT_RATE = 7.3;

export interface TronChannelConfig {
  address: string; // 收款钱包地址 (T开头)
  rate?: string; // 汇率设置: 'auto' 或固定数值 如 '7.35'
  timeout?: string; // 订单超时分钟 (默认 15)
  trongrid_key?: string; // 可选的 TronGrid API Key
  api_base?: string; // 自定义节点地址 (用于测试或专线, 留空用官方)
}

export interface TronOrderExt {
  wallet: string;
  pay_usdt: string; // 格式化后的 USDT 金额, 如 "13.6942"
  pay_sun: number; // 整数 SUN (1 USDT = 1,000,000 SUN), 如 13694200
  rate: string; // 计算时的汇率
  expire_at: number; // 过期时间戳 (秒)
  last_poll?: number; // 上次查链时间戳 (秒), 用于节流
}

/** 获取实时或固定的 USDT/CNY 汇率 */
export async function getUsdtRate(cfgRate?: string): Promise<number> {
  const custom = parseFloat(cfgRate || '');
  if (!isNaN(custom) && custom > 0) return custom;

  // 尝试拉取实时行情 (CoinGecko / Binance)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny', {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as { tether?: { cny?: number } };
      if (data?.tether?.cny && data.tether.cny > 0) {
        return Math.round(data.tether.cny * 100) / 100;
      }
    }
  } catch {}

  return DEFAULT_USDT_RATE;
}

/** 确保为订单分配唯一的微尾数 USDT 金额并写入 orders.ext */
export async function ensureTronUsdtAmount(
  env: Bindings,
  order: OrderRow,
  cfg: TronChannelConfig
): Promise<TronOrderExt> {
  let ext: Record<string, unknown> = {};
  try {
    ext = JSON.parse(order.ext || '{}');
  } catch {}

  const wallet = (cfg.address || '').trim();
  if (!wallet) throw new Error('TRC20 钱包地址未配置');

  // 如果已经生成过且未过期，直接复用
  if (ext.pay_usdt && ext.pay_sun && ext.wallet) {
    return ext as unknown as TronOrderExt;
  }

  const rateNum = await getUsdtRate(cfg.rate);
  const timeoutMin = Math.max(5, parseInt(cfg.timeout || '15', 10) || 15);
  const baseUsdt = (order.money / 100) / rateNum;

  // 生成防撞单微尾数 (0.0001 ~ 0.0099)
  let chosenUsdt = '';
  let chosenSun = 0;

  for (let i = 0; i < 50; i++) {
    const suffix = (Math.floor(Math.random() * 99) + 1) / 10000;
    const candidate = (baseUsdt + suffix).toFixed(4);
    const candidateSun = Math.round(Number(candidate) * 1000000);

    // 检查是否有同一渠道的未支付订单占用了相同 SUN 金额
    const dup = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM orders WHERE channel=? AND status=0 AND id!=? AND ext LIKE ?`
    )
      .bind(order.channel as number, order.id, `%"pay_sun":${candidateSun}%`)
      .first<{ n: number }>();

    if (!dup?.n) {
      chosenUsdt = candidate;
      chosenSun = candidateSun;
      break;
    }
  }

  // 极端情况下若循环未找到唯一尾数，取当前时间微秒做后两位
  if (!chosenUsdt) {
    const fallbackSuffix = ((Date.now() % 99) + 1) / 10000;
    chosenUsdt = (baseUsdt + fallbackSuffix).toFixed(4);
    chosenSun = Math.round(Number(chosenUsdt) * 1000000);
  }

  const tronExt: TronOrderExt = {
    wallet,
    pay_usdt: chosenUsdt,
    pay_sun: chosenSun,
    rate: rateNum.toFixed(2),
    expire_at: now() + timeoutMin * 60,
  };

  await env.DB.prepare('UPDATE orders SET ext=? WHERE id=?')
    .bind(JSON.stringify({ ...ext, ...tronExt }), order.id)
    .run();

  return tronExt;
}

interface NormalizedTransfer {
  txid: string;
  to: string;
  value: string;
  timeMs: number;
}

/** 调波场 RPC / 区块浏览器查询指定钱包最近的 TRC20 转账 */
export async function fetchTronTransfers(
  wallet: string,
  apiBase?: string,
  apiKey?: string
): Promise<NormalizedTransfer[]> {
  const base = (apiBase || '').trim().replace(/\/+$/, '') || 'https://api.trongrid.io';
  const url = `${base}/v1/accounts/${wallet}/transactions/trc20?limit=25&contract_address=${USDT_TRC20_CONTRACT}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey.trim();

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(4500) });
    if (resp.ok) {
      const j = (await resp.json()) as {
        data?: Array<{
          transaction_id: string;
          to: string;
          value: string;
          block_timestamp: number;
          token_info?: { address: string };
        }>;
      };
      if (Array.isArray(j?.data)) {
        return j.data.map((t) => ({
          txid: t.transaction_id,
          to: t.to,
          value: t.value,
          timeMs: t.block_timestamp,
        }));
      }
    }
  } catch {}

  // 备用源: Tronscan API (仅在非自定义节点时使用)
  if (!apiBase) {
    try {
      const scanUrl = `https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=25&start=0&contract_address=${USDT_TRC20_CONTRACT}&relatedAddress=${wallet}`;
      const sResp = await fetch(scanUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (sResp.ok) {
        const sj = (await sResp.json()) as {
          token_transfers?: Array<{
            transaction_id: string;
            to_address: string;
            quant: string;
            block_ts: number;
          }>;
        };
        if (Array.isArray(sj?.token_transfers)) {
          return sj.token_transfers.map((t) => ({
            txid: t.transaction_id,
            to: t.to_address,
            value: t.quant,
            timeMs: t.block_ts,
          }));
        }
      }
    } catch {}
  }

  return [];
}

/** 轮询核对单笔订单的波场链上到账状态 */
export async function pollTronOrder(env: Bindings, order: OrderRow): Promise<boolean> {
  if (order.status !== 0) return false;

  let ext: Record<string, unknown> = {};
  try {
    ext = JSON.parse(order.ext || '{}');
  } catch {}

  const wallet = typeof ext.wallet === 'string' ? ext.wallet : '';
  const paySun = typeof ext.pay_sun === 'number' ? ext.pay_sun : 0;
  if (!wallet || !paySun) return false;

  const current = now();
  const expireAt = typeof ext.expire_at === 'number' ? ext.expire_at : 0;
  // 超时检查: 超时不再自动认领
  if (expireAt && current > expireAt) return false;

  // 5秒节流, 避免前端每2秒轮询造成波场API超频
  const lastPoll = typeof ext.last_poll === 'number' ? ext.last_poll : 0;
  if (lastPoll && current - lastPoll < 5) return false;

  ext.last_poll = current;
  await env.DB.prepare('UPDATE orders SET ext=? WHERE id=?').bind(JSON.stringify(ext), order.id).run();

  // 取渠道配置 (节点地址/API Key)
  const ch = await env.DB.prepare('SELECT config FROM channels WHERE id=?')
    .bind(order.channel)
    .first<{ config: string }>();
  let cfg: TronChannelConfig = { address: wallet };
  try {
    cfg = JSON.parse(ch?.config || '{}');
  } catch {}

  const transfers = await fetchTronTransfers(wallet, cfg.api_base, cfg.trongrid_key);
  if (!transfers.length) return false;

  const expectedSun = String(paySun);
  const orderTime = order.addtime || current;
  const minTimeMs = (orderTime - 120) * 1000; // 宽容下单前2分钟

  for (const t of transfers) {
    if (t.to.toLowerCase() !== wallet.toLowerCase()) continue;
    if (String(t.value) !== expectedSun) continue;
    if (t.timeMs < minTimeMs) continue;

    // 检查此 txid 是否已在别的订单入过账 (防止重放攻击)
    const dup = await env.DB.prepare('SELECT id FROM orders WHERE api_trade_no=?').bind(t.txid).first();
    if (dup) continue;

    // 链上确认命中! 标记订单为已支付
    const paid = await markOrderPaid(env, order.trade_no, order.money, t.txid);
    if (paid) {
      const fullOrder = await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?')
        .bind(order.trade_no)
        .first<OrderRow>();
      if (fullOrder) {
        await sendMerchantNotifySafe(env, fullOrder);
      }
      return true;
    }
  }

  return false;
}

/** 定时任务批量扫链: 检索当前所有未支付的原生 USDT 订单进行链上查账 */
export async function pollAllTronOrders(env: Bindings): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM orders WHERE status=0 AND channel IN (SELECT id FROM channels WHERE plugin='tronusdt' AND status=1) ORDER BY id DESC LIMIT 15"
  ).all<OrderRow>();

  let count = 0;
  for (const o of results || []) {
    if (await pollTronOrder(env, o)) count++;
  }
  return count;
}
