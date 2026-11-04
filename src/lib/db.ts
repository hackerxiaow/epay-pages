/**
 * 业务层看到的「数据接口」。
 *
 * Cloudflare 版这里是 D1 的薄封装；EdgeOne 版换成 Blob 文档模型（`repo.ts`），
 * 函数名和语义保持不变，方便和 `main` 分支对照。
 */
import { Bindings } from './auth';
import { now } from './util';
import * as repo from './repo';

export type { ConfigKV, UserRow, OrderRow, GroupRow, ChannelRow } from './repo';

export const getConfigAll = (): Promise<repo.ConfigKV> => repo.cfgAll();
export const getConfig = (k: string): Promise<string | null> => repo.cfgGet(k);
export const setConfig = (k: string, v: string): Promise<void> => repo.cfgSet(k, v);
export const getUserByUid = (uid: number): Promise<repo.UserRow | null> => repo.userByUid(uid);

/**
 * 订单支付成功落账。
 *
 * 原实现用 `UPDATE ... WHERE status=0` 的受影响行数做乐观锁；Blob 没有行锁，
 * 这里改成两道闸：
 *   1. `paid/<trade_no>` 条件写（onlyIfNew）—— 等价于「只有第一个回调能进来」
 *   2. `orderPatch(..., expect status=0)` —— 状态机二次校验
 *
 * 返回 true 表示本次调用完成了状态流转（需要通知商户），false 表示已被处理过。
 */
export async function markOrderPaid(
  env: Bindings,
  tradeNo: string,
  realmoney: number,
  apiTradeNo: string
): Promise<boolean> {
  const order = await repo.orderByTradeNo(tradeNo);
  if (!order) return false;
  if (order.status !== 0) return false;

  if (!(await repo.claimPaid(tradeNo))) return false;

  const moved = await repo.orderPatch(
    tradeNo,
    { status: 1, realmoney, endtime: now(), api_trade_no: apiTradeNo },
    (o) => o.status === 0
  );
  if (!moved) {
    await repo.releasePaid(tradeNo);
    return false;
  }

  // 即时到账: 按分组费率扣手续费后入账
  const user = await repo.userByUid(order.uid);
  const group = user ? await repo.groupGet(user.gid) : null;
  const rate = group?.rate || 0;
  const fee = Math.round((order.money * rate) / 100);
  const credit = order.money - fee;

  const credited = await repo.userAddMoney(order.uid, credit);
  if (!credited) {
    // 回滚订单状态, 下次重试
    await repo.orderPatch(tradeNo, { status: 0, realmoney: 0 }, (o) => o.status === 1);
    await repo.releasePaid(tradeNo);
    return false;
  }
  await repo.recordAdd(
    order.uid,
    1,
    credit,
    `订单 ${tradeNo} 收款` + (fee > 0 ? `（手续费 ${(fee / 100).toFixed(2)}）` : '')
  );

  // 邀请返利
  const inviteRate = parseFloat((await repo.cfgGet('invite_rate')) || '0');
  if (inviteRate > 0) {
    const inviter = user?.invite_uid || 0;
    if (inviter) {
      const rebate = Math.round((order.money * inviteRate) / 100);
      if (rebate > 0) {
        await repo.userAddMoney(inviter, rebate);
        await repo.recordAdd(inviter, 4, rebate, `邀请商户 ${order.uid} 订单 ${tradeNo} 返利`);
      }
    }
  }
  return true;
}

/** 退款: 扣商户余额, 订单状态置 2 */
export async function markOrderRefunded(env: Bindings, tradeNo: string): Promise<{ ok: boolean; msg: string }> {
  const order = await repo.orderByTradeNo(tradeNo);
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.status !== 1 && order.status !== 3) return { ok: false, msg: '订单状态不支持退款' };

  const prev = order.status;
  const moved = await repo.orderPatch(tradeNo, { status: 2 }, (o) => o.status === 1 || o.status === 3);
  if (!moved) return { ok: false, msg: '订单状态已变更' };

  const deducted = await repo.userAddMoney(order.uid, -order.money);
  if (!deducted) {
    await repo.orderPatch(tradeNo, { status: prev }, (o) => o.status === 2);
    return { ok: false, msg: '商户余额不足, 无法退款' };
  }
  await repo.recordAdd(order.uid, 2, order.money, `订单 ${tradeNo} 退款`);
  return { ok: true, msg: 'ok' };
}
