import { Bindings } from './auth';
import { getConfig, getUserByUid, markOrderPaid, OrderRow, UserRow } from './db';
import { buildSign, buildSignString, md5 } from './sign';
import { cents2str } from './util';
import { rsaSign, rsaVerify } from './rsa';

export { markOrderPaid, buildSign };

/** 商户签名: RSA 商户用平台私钥, MD5 商户用商户密钥 (原版协议兼容) */
export async function merchantSign(env: Bindings, user: UserRow, params: Record<string, string>): Promise<string> {
  const str = buildSignString(params);
  if (user.keytype === 1 && user.publickey) {
    const priv = (await getConfig(env.DB, 'rsa_private')) || '';
    if (!priv) throw new Error('平台RSA私钥未配置');
    return await rsaSign(priv, str);
  }
  return md5(str + user.key);
}

/** 验证商户提交的签名 */
export async function verifyMerchantSign(
  user: UserRow,
  params: Record<string, string>,
  sign: string | undefined
): Promise<boolean> {
  if (!sign) return false;
  const str = buildSignString(params);
  if (user.keytype === 1 && user.publickey) return await rsaVerify(user.publickey, str, sign);
  return md5(str + user.key) === sign;
}

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
  const sign = await merchantSign(env, user, params);
  const st = user.keytype === 1 && user.publickey ? 'RSA' : 'MD5';
  const qs = new URLSearchParams({ ...params, sign, sign_type: st }).toString();
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

/** 构造同步回跳 return_url (带商户签名参数) */
export async function buildReturnUrl(env: Bindings, order: OrderRow): Promise<string> {
  if (!order.return_url) return '';
  const user = await getUserByUid(env.DB, order.uid);
  if (!user) return '';
  const params: Record<string, string> = {
    pid: String(order.uid),
    trade_no: order.trade_no,
    out_trade_no: order.out_trade_no || '',
    type: order.type,
    name: order.name || '',
    money: cents2str(order.money),
    trade_status: order.status === 1 || order.status === 3 ? 'TRADE_SUCCESS' : 'TRADE_CLOSED',
  };
  const sign = await merchantSign(env, user, params);
  const qs = new URLSearchParams({ ...params, sign, sign_type: 'MD5' }).toString();
  const sep = order.return_url.includes('?') ? '&' : '?';
  return order.return_url + sep + qs;
}
