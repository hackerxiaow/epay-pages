import { Bindings } from './auth';
import { now } from './util';

export interface ConfigKV {
  [k: string]: string;
}

export async function getConfigAll(db: D1Database): Promise<ConfigKV> {
  const { results } = await db.prepare('SELECT k, v FROM config').all<{ k: string; v: string }>();
  const map: ConfigKV = {};
  for (const r of results || []) map[r.k] = r.v;
  return map;
}

export async function getConfig(db: D1Database, k: string): Promise<string | null> {
  const row = await db.prepare('SELECT v FROM config WHERE k=?').bind(k).first<{ v: string }>();
  return row ? row.v : null;
}

export async function setConfig(db: D1Database, k: string, v: string): Promise<void> {
  await db
    .prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
    .bind(k, v)
    .run();
}

export interface UserRow {
  uid: number;
  gid: number;
  username: string;
  email: string;
  password: string;
  key: string;
  money: number;
  mode: number;
  status: number;
  regtime: number;
}

export async function getUserByUid(db: D1Database, uid: number): Promise<UserRow | null> {
  return await db.prepare('SELECT * FROM users WHERE uid=?').bind(uid).first<UserRow>();
}

export interface OrderRow {
  id: number;
  trade_no: string;
  out_trade_no: string | null;
  uid: number;
  type: string;
  channel: number | null;
  name: string | null;
  money: number;
  realmoney: number;
  status: number;
  addtime: number | null;
  endtime: number | null;
  notify_url: string;
  return_url: string;
  domain: string;
  ip: string;
  api_trade_no: string;
  notify_count: number;
  notify_status: number;
  ext: string;
}

/**
 * 订单支付成功落账: 乐观锁防并发重复回调, 成功落账才给商户余额加钱并记流水。
 * 返回 true 表示本次调用完成了状态流转(需要通知商户), false 表示已被处理过。
 */
export async function markOrderPaid(
  env: Bindings,
  tradeNo: string,
  realmoney: number,
  apiTradeNo: string
): Promise<boolean> {
  const db = env.DB;
  const order = await db
    .prepare('SELECT * FROM orders WHERE trade_no=?')
    .bind(tradeNo)
    .first<OrderRow>();
  if (!order) return false;
  if (order.status !== 0) return false;

  const res = await db
    .prepare('UPDATE orders SET status=1, realmoney=?, endtime=?, api_trade_no=? WHERE trade_no=? AND status=0')
    .bind(realmoney, now(), apiTradeNo, tradeNo)
    .run();
  if (!res.meta.changes) return false;

  // 商户余额即时入账 (即时到账核心)
  const credit = await db
    .prepare('UPDATE users SET money=money+? WHERE uid=?')
    .bind(order.money, order.uid)
    .run();
  if (!credit.meta.changes) {
    // 回滚订单状态, 下次重试
    await db.prepare('UPDATE orders SET status=0, realmoney=0 WHERE trade_no=? AND status=1').bind(tradeNo).run();
    return false;
  }
  await db
    .prepare('INSERT INTO records (uid, type, money, addtime, note) VALUES (?,1,?,?,?)')
    .bind(order.uid, order.money, now(), `订单 ${tradeNo} 收款`)
    .run();
  return true;
}

/** 退款: 扣商户余额, 订单状态置 2 */
export async function markOrderRefunded(env: Bindings, tradeNo: string): Promise<{ ok: boolean; msg: string }> {
  const db = env.DB;
  const order = await db.prepare('SELECT * FROM orders WHERE trade_no=?').bind(tradeNo).first<OrderRow>();
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.status !== 1 && order.status !== 3) return { ok: false, msg: '订单状态不支持退款' };

  const res = await db
    .prepare('UPDATE orders SET status=2 WHERE trade_no=? AND (status=1 OR status=3)')
    .bind(tradeNo)
    .run();
  if (!res.meta.changes) return { ok: false, msg: '订单状态已变更' };

  const deduct = await db
    .prepare('UPDATE users SET money=money-? WHERE uid=? AND money>=?')
    .bind(order.money, order.uid, order.money)
    .run();
  if (!deduct.meta.changes) {
    await db.prepare('UPDATE orders SET status=1 WHERE trade_no=? AND status=2').bind(tradeNo).run();
    return { ok: false, msg: '商户余额不足, 无法退款' };
  }
  await db
    .prepare('INSERT INTO records (uid, type, money, addtime, note) VALUES (?,2,?,?,?)')
    .bind(order.uid, order.money, now(), `订单 ${tradeNo} 退款`)
    .run();
  return { ok: true, msg: 'ok' };
}
