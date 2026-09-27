import { cents2str, now, str2cents } from '../util';
import { Bindings } from '../auth';
import { getConfig, setConfig } from '../db';
import { ChannelCtx, ChannelPlugin, ChannelRow } from '../channel';
import { markOrderPaid, sendMerchantNotifySafe } from '../orderflow';
import { alipayRequest } from './alipayf2f';
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
  cookie?: string;
  appid?: string; // 开放平台 APPID (填了则走官方API, 免CK)
  private_key?: string; // 应用私钥
  alipay_public_key?: string; // 支付宝公钥
  gateway?: string; // 网关(测试可覆盖)
  user_id?: string; // 支付宝用户ID(PID, 2088开头, 用于生成免输金额转账链接)
  bill_url?: string; // Cookie 模式账单页, 测试可覆盖
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

/** 解析官方 accountlog.query 响应: 递归提取含 trans_dt/trans_amount 的流水 */
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
        const isIn = direction === 'in' || direction === '收入' || direction === '' ;
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
export async function ensurePayAmount(env: Bindings, order: OrderRow, suffixOn: boolean): Promise<string> {
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

/** 拉取官方账单流水 (免CK): 复用开放平台 RSA2 客户端 */
async function fetchAccountLogBills(cfg: AlipayBillConfig): Promise<BillEntry[]> {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const billDate = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  try {
    const r = await alipayRequest(cfg as unknown as Parameters<typeof alipayRequest>[0], 'alipay.data.bill.accountlog.query', { bill_date: billDate });
    if (r.code !== '10000') return [];
    return parseAccountLog(JSON.stringify(r.data || {}));
  } catch {
    return [];
  }
}

export const alipayBillPlugin: ChannelPlugin = {
  id: 'alipaybill',
  name: '支付宝个人码(账单轮询·免挂机/免CK)',
  types: ['alipay'],
  inputs: [
    { name: 'appid', label: '开放平台APPID(20开头, 填了即免CK模式)', required: false },
    { name: 'private_key', label: '应用私钥(免CK模式)', multiline: true },
    { name: 'alipay_public_key', label: '支付宝公钥(免CK模式)', multiline: true },
    { name: 'gateway', label: '网关(留空用官方, 测试可覆盖)' },
    { name: 'cookie', label: '网页Cookie(旧方案, 免CK不填)' },
    { name: 'user_id', label: '支付宝用户ID(PID, 2088开头, 用于免输金额转账)' },
    { name: 'bill_url', label: 'Cookie模式账单接口地址(留空用默认)' },
    { name: 'qrcode_alipay', label: '个人收款码图片链接' },
    { name: 'pay_suffix', label: '尾数防撞单(1开, 默认开)' },
  ],

  async createOrder(ctx: ChannelCtx) {
    const cfg = parseConfig(JSON.stringify(ctx.channel.config));
    const suffixOn = cfg.pay_suffix !== '0';
    const payAmount = await ensurePayAmount(ctx.env, ctx.order, suffixOn);
    // 免输金额转账链接: 唤起支付宝APP且金额已填好
    let transferUrl = '';
    if (cfg.user_id) {
      transferUrl = `alipays://platformapi/startapp?appId=20000123&actionType=toAccount&userId=${encodeURIComponent(cfg.user_id)}&amount=${encodeURIComponent(payAmount)}&memo=${encodeURIComponent(ctx.order.trade_no)}`;
    }
    return { ok: true, qrContent: cfg.qrcode_alipay || '', payAmount, transferUrl };
  },
};

/** 拉取并匹配一个渠道的账单 */
export async function pollAlipayBillChannel(env: Bindings, ch: ChannelRow): Promise<number> {
  const cfg = parseConfig(ch.config);
  let bills: BillEntry[] = [];
  if (cfg.appid && cfg.private_key) {
    // 官方 API 账单源 (免CK): alipay.data.bill.accountlog.query
    bills = await fetchAccountLogBills(cfg);
  } else if (cfg.cookie) {
    // 网页 Cookie 账单源 (旧方案)
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
    bills = parseBills(text);
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
      // 超出匹配窗口的旧账单, 永远不会再匹配, 直接标记避免反复扫描
      seenSet.add(b.id);
      continue;
    }
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
