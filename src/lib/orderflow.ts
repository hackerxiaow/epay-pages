import { Bindings } from './auth';
import { getUserByUid, markOrderPaid, OrderRow } from './db';
import { buildSign } from './sign';
import { cents2str } from './util';

export { markOrderPaid };

/** 支付成功后向商户 notify_url 发送异步通知 */
export async function sendMerchantNotify(env: Bindings, order: OrderRow): Promise<boolean> {
  if (!order.notify_url) return true;
  const user = await getUserByUid(env.DB, order.uid);
  if (!user) return false;
  const params: Record<string, string> = {
    pid: String(order.uid),
    trade_no: order.trade_no,
    out_trade_no: order.out_trade_no || '',
    type: order.type,
    name: order.name || '',
    money: cents2str(order.money),
    trade_status: 'TRADE_SUCCESS',
  };
  const sign = buildSign(params, user.key);
  const qs = new URLSearchParams({ ...params, sign, sign_type: 'MD5' }).toString();
  const sep = order.notify_url.includes('?') ? '&' : '?';
  try {
    const resp = await fetch(order.notify_url + sep + qs, { signal: AbortSignal.timeout(8000) });
    const text = (await resp.text()).trim();
    if (text === 'success') {
      await env.DB.prepare('UPDATE orders SET notify_status=1 WHERE trade_no=?').bind(order.trade_no).run();
      return true;
    }
  } catch {}
  await env.DB.prepare('UPDATE orders SET notify_count=notify_count+1 WHERE trade_no=?').bind(order.trade_no).run();
  return false;
}

export async function sendMerchantNotifySafe(env: Bindings, order: OrderRow): Promise<void> {
  try {
    await sendMerchantNotify(env, order);
  } catch {}
}
