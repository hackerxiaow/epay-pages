/**
 * 定时任务（通知重试 + 账单轮询 + 链上扫账）。
 *
 * Cloudflare 版只有 `/api/cron?token=` 一个入口，靠外部 cron 打。
 * EdgeOne 版多了一个平台调度入口（`/api/cron/tick`），两者共用这一份实现：
 *   - `/api/cron?token=xxx`   token 取自数据库里的 cron_token（兼容原用法）
 *   - `/api/cron/tick?token=xxx` token 取自环境变量 CRON_TOKEN（平台 schedules 用）
 */
import { Bindings } from './auth';
import { sendMerchantNotifySafe } from './orderflow';
import { orderByTradeNo, orderListNotifyRetry } from './repo';
import { now } from './util';

export interface CronResult {
  retried: number;
  bill_matched: number;
  tron_matched: number;
  time: number;
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
