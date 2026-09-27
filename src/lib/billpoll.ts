/**
 * 通用账单轮询引擎 —— 支付宝(网页Cookie/官方API免CK) + QQ钱包(网页Cookie)
 * 由 channels 表驱动: plugin='alipaybill' 走支付宝源, plugin='qqbill' 走QQ钱包源
 */
import { Bindings } from './auth';
import { getConfig, setConfig } from './db';
import { now, str2cents } from './util';
import { ChannelRow } from './channel';
import { markOrderPaid, sendMerchantNotifySafe } from './orderflow';
import { alipayRequest } from './plugins/alipayf2f';

export interface BillChannelConfig {
  cookie?: string;
  appid?: string; // 支付宝官方API(免CK)
  private_key?: string;
  alipay_public_key?: string;
  gateway?: string;
  user_id?: string; // 支付宝PID(免输金额转账链接)
  bill_url?: string; // 账单接口(留空用默认), 测试可覆盖
  qrcode_alipay?: string;
  qrcode_qqpay?: string;
  qrcode?: string; // 收款码图片链接
  pay_suffix?: string;
}

export function parseBillConfig(raw: string): BillChannelConfig {
  return JSON.parse(raw || '{}') as BillChannelConfig;
}

export interface BillEntry {
  id: string;
  time: number;
  amount: number;
}

/** 解析官方 accountlog.query 响应(支付宝免CK) */
export function parseAccountLog(text: string): BillEntry[] {
  const out: BillEntry[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const dt = String(obj.trans_dt || obj.trans_date || obj.trade_date || '');
      const amt = Number(obj.trans_amount ?? obj.amount ?? 0);
      if (dt && amt > 0) {
        const ts = billTime(dt) || Math.floor(Date.parse(dt.replace(' ', 'T') + '+08:00') / 1000) || Math.floor(new Date(dt).getTime() / 1000);
        const direction = String(obj.trans_direction ?? obj.direction ?? obj.in_out ?? 'in');
        const isIn = direction === 'in' || direction === '收入' || direction === '';
        const id = String(obj.trade_no || obj.trans_no || obj.order_no || `${ts}_${Math.round(amt * 100)}`);
        if (ts > 0 && isIn && !seen.has(id)) {
          seen.add(id);
          out.push({ id, time: ts, amount: Math.round(amt * 100) });
        }
      }
      Object.values(obj).forEach(walk);
    }
  };
  try {
    walk(JSON.parse(text));
  } catch {}
  return out;
}

/** 北京时间字符串 -> unix 秒 */
export function billTime(s: string): number {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return Math.floor(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+08:00`) / 1000);
}

/** 解析账单页: 支持表格HTML 与 JSON 数组 */
export function parseBills(text: string): BillEntry[] {
  const out: BillEntry[] = [];
  if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
    try {
      const arr = JSON.parse(text) as Array<Record<string, unknown>>;
      for (const it of Array.isArray(arr) ? arr : []) {
        const ts = billTime(String(it.time || ''));
        const amt = str2cents(String(it.amount || ''));
        if (ts && amt > 0) out.push({ id: String(it.id || `${ts}_${amt}`), time: ts, amount: amt });
      }
      return out;
    } catch {}
  }
  const re = /<tr class="bill">[\s\S]*?class="time">([^<]+)<[\s\S]*?class="amount">[¥￥]\s*([\d.]+)<[\s\S]*?class="type">([^<]*)<[\s\S]*?<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ts = billTime(m[1].trim());
    const amt = str2cents(m[2]);
    if (ts && amt > 0 && !m[3].includes('支出')) {
      out.push({ id: `${ts}_${amt}`, time: ts, amount: amt });
    }
  }
  return out;
}

/** 计算唯一尾数支付金额, 写入订单 ext */
export async function ensurePayAmount(env: Bindings, order: { id: number; channel: number | null; money: number; ext: string }, suffixOn: boolean): Promise<string> {
  let ext: Record<string, unknown> = {};
  try {
    ext = JSON.parse(order.ext || '{}');
  } catch {}
  if (ext.pay_amount) return String(ext.pay_amount);
  if (!suffixOn) return (order.money / 100).toFixed(2);
  for (let i = 0; i < 60; i++) {
    const suffix = Math.floor(Math.random() * 99) + 1;
    const pay = (order.money / 100 + suffix / 100).toFixed(2);
    const dup = await env.DB.prepare(
      `SELECT COUNT(*) n FROM orders WHERE channel=? AND status=0 AND id!=? AND ext LIKE ?`
    )
      .bind(order.channel as number, order.id, `%"pay_amount":"${pay}"%`)
      .first<{ n: number }>();
    if (!dup?.n) {
      ext.pay_amount = pay;
      await env.DB.prepare('UPDATE orders SET ext=? WHERE id=?').bind(JSON.stringify(ext), order.id).run();
      return pay;
    }
  }
  return (order.money / 100).toFixed(2);
}

/** 拉取支付宝官方账单流水(免CK) */
async function fetchAccountLogBills(cfg: BillChannelConfig): Promise<BillEntry[]> {
  const d = new Date(now() * 1000 + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const billDate = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  try {
    const r = await alipayRequest(cfg as never, 'alipay.data.bill.accountlog.query', { bill_date: billDate });
    if (r.code !== '10000') return [];
    return parseAccountLog(JSON.stringify(r.data || {}));
  } catch {
    return [];
  }
}

function billHttp(cfg: BillChannelConfig): Promise<string> {
  const url = cfg.bill_url || '';
  return fetch(url, {
    headers: {
      Cookie: cfg.cookie || '',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.text());
}

/** 轮询一个账单渠道: 按配置选择 官方API / Cookie 账单页 */
export async function pollBillChannel(env: Bindings, ch: ChannelRow): Promise<number> {
  const cfg = parseBillConfig(ch.config);
  let bills: BillEntry[] = [];
  if (cfg.appid && cfg.private_key) {
    bills = await fetchAccountLogBills(cfg);
  } else if (cfg.cookie && cfg.bill_url) {
    try {
      bills = parseBills(await billHttp(cfg));
    } catch {
      return 0;
    }
  } else {
    return 0;
  }
  if (!bills.length) return 0;

  let seen: string[] = [];
  try {
    seen = JSON.parse((await getConfig(env.DB, `bill_seen_${ch.id}`)) || '[]');
  } catch {}
  const seenSet = new Set(seen);
  let matched = 0;

  for (const b of bills) {
    if (seenSet.has(b.id)) continue;
    if (b.time < now() - 86400) {
      seenSet.add(b.id);
      continue;
    }
    const { results } = await env.DB.prepare(
      'SELECT * FROM orders WHERE channel=? AND status=0 AND addtime<=? AND addtime>=? ORDER BY id ASC LIMIT 20'
    )
      .bind(ch.id, b.time, b.time - 86400)
      .all<{ id: number; trade_no: string; money: number; status: number; channel: number; ext: string }>();
    for (const o of results || []) {
      let ext: Record<string, unknown> = {};
      try {
        ext = JSON.parse(o.ext || '{}');
      } catch {}
      const pay = ext.pay_amount ? str2cents(String(ext.pay_amount)) : o.money;
      if (pay !== b.amount) continue;
      const paid = await markOrderPaid(env, o.trade_no, b.amount, 'BILL' + b.id);
      if (paid) {
        matched++;
        const full = await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(o.trade_no).first<{ trade_no: string; uid: number; notify_url: string; out_trade_no: string; type: string; name: string; money: number }>();
        if (full) await sendMerchantNotifySafe(env, full as never);
      }
      seenSet.add(b.id);
      break;
    }
  }
  if (seenSet.size !== seen.length) {
    await setConfig(env.DB, `bill_seen_${ch.id}`, JSON.stringify(Array.from(seenSet).slice(-300)));
  }
  return matched;
}

/** 节流全渠道轮询 (10s), 由收银台懒轮询/外部cron驱动 */
export async function pollAllBills(env: Bindings): Promise<number> {
  const last = await env.DB.prepare("SELECT v FROM config WHERE k='bill_last_poll'").first<{ v: string }>();
  if (last && parseInt(last.v, 10) > now() - 10) return -1;
  await setConfig(env.DB, 'bill_last_poll', String(now()));
  const { results } = await env.DB.prepare(
    "SELECT * FROM channels WHERE plugin IN ('alipaybill','qqbill') AND status=1"
  ).all<ChannelRow>();
  let total = 0;
  for (const ch of results || []) {
    total += await pollBillChannel(env, ch);
  }
  return total;
}
