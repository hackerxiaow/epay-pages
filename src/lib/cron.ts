/**
 * 定时任务（通知重试 + 账单轮询 + 链上扫账）。
 *
 * Cloudflare 版只有 `/api/cron?token=` 一个入口，靠外部 cron 打。
 * EdgeOne 版多了一个平台调度入口（`/api/cron/tick`），两者共用这一份实现：
 *   - `/api/cron?token=xxx`      token 取自数据库里的 cron_token（兼容原用法）
 *   - `/api/cron/tick?token=xxx` token 取自环境变量 CRON_TOKEN（平台 schedules 用）
 *
 * `/api/cron/tick` 刻意做成「口令可选」：`edgeone.json` 是要提交进仓库的，
 * 把真实口令写进去等于把密钥推上 GitHub。所以没配 `CRON_TOKEN` 时走频率闸门
 * （默认 5 分钟一次），配了才做严格校验。
 */
import { Bindings } from './auth';
import { sendMerchantNotifySafe } from './orderflow';
import { cfgGet, cfgSet, orderByTradeNo, orderListNotifyRetry } from './repo';
import { now } from './util';

export interface CronResult {
  retried: number;
  bill_matched: number;
  tron_matched: number;
  time: number;
}

/** 未配置 CRON_TOKEN 时，两次平台调度之间的最小间隔（秒） */
const TICK_MIN_GAP = 300;

/**
 * 校验调度请求。
 * 返回 null 表示放行；返回 Response 表示拒绝（并带上原因）。
 */
export async function guardCronTick(
  token: string | null,
  expected: string,
  minGapSec = TICK_MIN_GAP
): Promise<Response | null> {
  if (expected) {
    if (token !== expected) return Response.json({ code: 0, msg: 'token 不匹配' }, { status: 403 });
    return null;
  }
  // 没配口令：只允许按最小间隔触发，避免被当成免费的计算入口刷
  const last = Number((await cfgGet('cron_tick_last')) || '0');
  if (last && now() - last < minGapSec) {
    return Response.json({ code: 0, msg: `未配置 CRON_TOKEN，已限流（${minGapSec}s 一次）` }, { status: 429 });
  }
  await cfgSet('cron_tick_last', String(now()));
  return null;
}


export async function runCron(env: Bindings): Promise<CronResult> {
  const orders = await orderListNotifyRetry(20);
  let retried = 0;
  for (const order of orders) {
    const full = await orderByTradeNo(order.trade_no);
    if (!full) continue;
    await sendMerchantNotifySafe(env, full);
    retried++;
  }

  // 账单轮询 (支付宝个人码免挂机通道)
  const { pollAllBills } = await import('./billpoll');
  const billMatched = await pollAllBills(env);

  // 原生 USDT (TRC20 链上自动扫账)
  const { pollAllTronOrders } = await import('./tronusdt');
  const tronMatched = await pollAllTronOrders(env);

  return { retried, bill_matched: billMatched, tron_matched: tronMatched, time: now() };
}
