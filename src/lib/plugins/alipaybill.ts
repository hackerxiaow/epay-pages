import { cents2str, now, str2cents } from '../util';
import { Bindings } from '../auth';
import { getConfig, setConfig } from '../db';
import { ChannelCtx, ChannelPlugin, ChannelRow } from '../channel';
import { markOrderPaid, sendMerchantNotifySafe } from '../orderflow';
import { OrderRow } from '../db';

/**
 * 支付宝个人码账单轮询插件 —— V免签免挂机改造版
 *
 * 原理: 用支付宝网页版登录 Cookie 定时拉取"最近账单", 按 金额尾数+时间窗
 * 匹配待支付订单自动确认。挂机的是 Cloudflare, 手机彻底不需要。
 * 收款码仍为个人码; 金额由收银台加唯一尾数(0.01~0.99)避免多人同时支付撞单。
 *
 * 兜底: Cookie 失效/接口变更时账单拉不到, 订单保持待支付, 可切 VMQ 云挂机双保险。
 */

export interface AlipayBillConfig {
  cookie: string;
  bill_url?: string; // 默认 consumeprod.alipay.com 账单页, 测试可覆盖
  qrcode_alipay?: string; // 收款码图片链接 (展示给买家)
  pay_suffix?: string; // '1' 启用尾数防撞单 (默认开)
}

function parseConfig(raw: string): AlipayBillConfig {
  return JSON.parse(raw || '{}') as AlipayBillConfig;
}

/** 账单条目 */
export interface BillEntry {
  id: string;
  time: number; // unix 秒
  amount: number; // 分
}

/** 解析账单: 支持表格 HTML 与 JSON 数组两种格式 */
export function parseBills(text: string): BillEntry[] {
  const out: BillEntry[] = [];
  // JSON: [{time:"2026-09-27 20:00:01", amount:"5.55", id:"..."}]
  if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
    try {
      const arr = JSON.parse(text) as Array<Record<string, unknown>>;
      for (const it of Array.isArray(arr) ? arr : []) {
        const t = String(it.time || '');
        const ts = billTime(t);
        const amt = str2cents(String(it.amount || ''));
        if (ts && amt > 0) out.push({ id: String(it.id || `${ts}_${amt}`), time: ts, amount: amt });
      }
      return out;
    } catch {}
  }
  // HTML 表格行: <tr class="bill"><td class="time">...</td><td class="amount">¥5.55</td><td class="type">收入</td></tr>
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

/** 北京时间字符串 -> unix 秒 */
function billTime(s: string): number {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return Math.floor(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+08:00`) / 1000);
}

/** 计算唯一尾数支付金额, 写入订单 ext */
async function ensurePayAmount(env: Bindings, order: OrderRow, suffixOn: boolean): Promise<string> {
  let ext: Record<string, unknown> = {};
  try {
    ext = JSON.parse(order.ext || '{}');
  } catch {}
  if (ext.pay_amount) return String(ext.pay_amount);
  if (!suffixOn) return cents2str(order.money);
  for (let i = 0; i < 60; i++) {
    const suffix = Math.floor(Math.random() * 99) + 1;
    const pay = cents2str(order.money + suffix);
    const dup = await env.DB.prepare(
      `SELECT COUNT(*) n FROM orders WHERE channel=? AND status=0 AND id!=? AND ext LIKE ?`
    )
      .bind(order.channel, order.id, `%"pay_amount":"${pay}"%`)
      .first<{ n: number }>();
    if (!dup?.n) {
      ext.pay_amount = pay;
      await env.DB.prepare('UPDATE orders SET ext=? WHERE id=?').bind(JSON.stringify(ext), order.id).run();
      return pay;
    }
  }
  return cents2str(order.money);
}

export const alipayBillPlugin: ChannelPlugin = {
  id: 'alipaybill',
  name: '支付宝个人码(账单轮询·免挂机)',
  types: ['alipay'],
  inputs: [
    { name: 'cookie', label: '支付宝网页版 Cookie(整串粘贴)', required: true, multiline: true },
    { name: 'bill_url', label: '账单接口地址(留空用默认)' },
    { name: 'qrcode_alipay', label: '个人收款码图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = parseConfig(JSON.stringify(ctx.channel.config));
    const suffixOn = cfg.pay_suffix !== '0';
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, suffixOn);
    return { ok: true, qrContent: cfg.qrcode_alipay || '', payAmount };
  },
};

/** 拉取并匹配一个渠道的账单 */
export async function pollAlipayBillChannel(env: Bindings, ch: ChannelRow): Promise<number> {
  const cfg = parseConfig(ch.config);
  if (!cfg.cookie) return 0;
  const url = cfg.bill_url || 'https://consumeprod.alipay.com/finance/record.htm';
  let text = '';
  try {
    const resp = await fetch(url, {
      headers: {
        Cookie: cfg.cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        Referer: 'https://my.alipay.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    text = await resp.text();
  } catch {
    return 0;
  }
  const bills = parseBills(text);
  if (!bills.length) return 0;

  let seen: string[] = [];
  try {
    seen = JSON.parse((await getConfig(env.DB, `bill_seen_${ch.id}`)) || '[]');
  } catch {}
  const seenSet = new Set(seen);
  let matched = 0;

  for (const b of bills) {
    if (seenSet.has(b.id)) continue;
    // 时间窗: 账单前24h内创建的待支付订单
    const { results } = await env.DB.prepare(
      'SELECT * FROM orders WHERE channel=? AND status=0 AND addtime<=? AND addtime>=? ORDER BY id ASC LIMIT 20'
    )
      .bind(ch.id, b.time, b.time - 86400)
      .all<OrderRow>();
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
        const full = await env.DB.prepare('SELECT * FROM orders WHERE trade_no=?').bind(o.trade_no).first<OrderRow>();
        if (full) await sendMerchantNotifySafe(env, full);
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

/** 节流全渠道轮询 (10s 一次, 由收银台轮询/外部cron驱动) */
export async function pollAllBills(env: Bindings): Promise<number> {
  const last = await env.DB.prepare("SELECT v FROM config WHERE k='bill_last_poll'").first<{ v: string }>();
  if (last && parseInt(last.v, 10) > now() - 10) return -1;
  await setConfig(env.DB, 'bill_last_poll', String(now()));
  const { results } = await env.DB.prepare("SELECT * FROM channels WHERE plugin='alipaybill' AND status=1").all<ChannelRow>();
  let total = 0;
  for (const ch of results || []) {
    total += await pollAlipayBillChannel(env, ch);
  }
  return total;
}
