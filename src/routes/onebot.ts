import { Hono } from 'hono';
import { Bindings } from '../lib/auth';
import { getConfig, OrderRow } from '../lib/db';
import { now, str2cents } from '../lib/util';
import { markOrderPaid, sendMerchantNotifySafe } from '../lib/orderflow';

/**
 * OneBot v11 HTTP 上报端点 —— QQ协议端(NapCat/LLOneBot/go-cqhttp) 直接对接
 * NapCat 配置 HTTP 上报地址: {site}/onebot/report?token=xxx
 * 收到 QQ钱包到账消息(含金额) → 按尾数金额匹配待支付 qqpay 订单 → 自动确认
 */
export const onebot = new Hono<{ Bindings: Bindings }>();

function extractAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:[¥￥]\s*|(\d+(?:\.\d{1,2})?)\s*元)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = str2cents(m[1] || m[0].replace(/[¥￥\s元]/g, ''));
    if (n > 0) out.push(n);
  }
  return out;
}

onebot.post('/onebot/report', async (c) => {
  const token = c.req.query('token') || '';
  const confToken = (await getConfig(c.env.DB, 'onebot_token')) || '';
  if (!confToken || token !== confToken) return c.json({ status: 'forbidden' }, 403);
  const ev = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // OneBot v11: post_type=message/private 或 notice; 文本在 raw_message / message
  let text = String(ev.raw_message ?? ev.post_content ?? '');
  if (!text && Array.isArray(ev.message)) {
    for (const seg of ev.message as Array<Record<string, unknown>>) {
      if (seg.type === 'text') text += String((seg.data as Record<string, unknown>)?.text || '');
    }
  }
  if (!text) return c.json({ status: 'ignored' });
  // 只关心 QQ钱包/转账/收款类消息
  if (!/转账|收款|到账|红包|QQ钱包|钱包/.test(text)) return c.json({ status: 'ignored' });

  const amounts = extractAmounts(text);
  if (!amounts.length) return c.json({ status: 'ignored' });

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM orders WHERE status=0 AND type='qqpay' AND addtime>=? ORDER BY id ASC LIMIT 50"
  )
    .bind(now() - 86400)
    .all<OrderRow>();
  for (const o of results || []) {
    let expect = o.money;
    try {
      const ext = JSON.parse(o.ext || '{}');
      if (ext.pay_amount) expect = str2cents(String(ext.pay_amount));
    } catch {}
    if (!amounts.includes(expect)) continue;
    const paid = await markOrderPaid(c.env, o.trade_no, expect, 'ONEBOT' + now());
    if (paid) {
      const full = await c.env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(o.trade_no).first<OrderRow>();
      if (full) c.executionCtx.waitUntil(sendMerchantNotifySafe(c.env, full));
    }
    return c.json({ status: 'ok' });
  }
  return c.json({ status: 'no_match' });
});
