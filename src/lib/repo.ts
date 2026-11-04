/**
 * Blob 上的数据层 —— EdgeOne 版没有 D1，这里把 8 张表建模成 key 前缀 + JSON 文档。
 *
 * 键空间：
 *
 *   cfg                         全站配置 {k: v}（一次读全量，进程内缓存 3s）
 *   u/<uid>                     商户
 *   un/<username>               → uid（条件写 = 用户名唯一）
 *   uctr                        商户 id 计数器
 *   ch/<id>                     渠道
 *   chctr                       渠道 id 计数器
 *   g/<id>                      商户分组
 *   gctr                        分组 id 计数器
 *   o/<trade_no>                订单全文（含 ext，支付逻辑的唯一真相源）
 *   oi/<id>                     → trade_no（后台按自增 id 操作）
 *   oapi/<api_trade_no>         → trade_no（上游单号反查 / 波场 txid 防重放）
 *   oidx/<YYYYMMDD>             当天订单摘要数组（订单列表、导出、按 IP 统计的扫描源）
 *   pend                        待支付订单摘要数组（status 一变就移出，匹配走它）
 *   mstat/<YYYY-MM>             月度统计 {n, sum, st[4], days{}, users{}}
 *   rc/<uid>/<id>               资金流水（一人一前缀，按 id 倒序取前 N 条）
 *   st/<id>                     结算申请
 *   stctr                       结算 id 计数器
 *   rg/<name>                   验证码 / 邮箱码（带过期时间）
 *   lk/<name>                   租约锁
 *
 * 三条刻意的取舍（都会影响行为，写在这里免得以后踩）：
 *
 *   1. **订单状态以 `o/<trade_no>` 为准**，`oidx/*` 与 `mstat/*` 是派生数据。
 *      派生数据用「订单锁 → 日桶 → 月统计」固定顺序加锁更新，不会死锁；
 *      万一进程在两把锁之间挂掉，列表可能短暂显示旧状态，点开订单详情仍是准的。
 *   2. **待支付队列 `pend` 是精确的**：下单写入，状态离开 0 就移出。
 *      vmq / onebot / 账单轮询这些「按金额匹配最早待支付单」的逻辑因此不用扫全表。
 *   3. **统计不做逐单累加**，只维护月度计数（`mstat`）。订单金额只在
 *      「0 → 已支付」那一次计入 `sum`，退款（1/3 → 2）不减 —— 与原 SQL
 *      `SUM(money) WHERE status>=1` 的口径一致。
 */
import { openStore, resetStore } from './blob-store';
import { now } from './util';

/* ------------------------------- 行类型 ------------------------------- */

export interface ConfigKV {
  [k: string]: string;
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
  keytype?: number;
  publickey?: string;
  domain?: string;
  invite_uid?: number;
  cert?: number;
  cert_name?: string;
  cert_no?: string;
}

export interface GroupRow {
  id: number;
  name: string;
  rate: number;
}

export interface ChannelRow {
  id: number;
  plugin: string;
  name: string;
  status: number;
  config: string;
  types: string;
  weight?: number;
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
  /** 派生字段：从 ext 里提出来的唯一尾数金额，供待支付匹配用（不落 `o/`） */
  pay_amount?: string;
  pay_sun?: number;
}

export interface RecordRow {
  id: number;
  uid: number;
  type: number;
  money: number;
  addtime: number;
  note: string;
}

export interface SettleRow {
  id: number;
  uid: number;
  amount: number;
  addtime: number;
  status: number;
  note: string;
}

type OrderSummary = Omit<OrderRow, 'ext'>;

export interface MonthStat {
  n: number;
  sum: number;
  /** 各状态单量，下标即 status（0 待支付 / 1 已支付 / 2 已退款 / 3 已完成） */
  st: [number, number, number, number];
  days: Record<string, { n: number; sum: number }>;
  users: Record<string, number>;
}

export interface SettleWithUser extends SettleRow {
  username: string;
}

/* ------------------------------- 基础工具 ------------------------------- */

function s() {
  return openStore();
}

const pad = (n: number, w = 12) => String(n).padStart(w, '0');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function readJson<T>(key: string): Promise<T | null> {
  return await s().getJson<T>(key);
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await s().put(key, JSON.stringify(value));
}

/** 上海时区的日期，与 SQLite `date(addtime,'unixepoch','+8 hours')` 对齐 */
export function shDate(ts: number): string {
  const d = new Date((ts + 8 * 3600) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const dayBucketOf = (ts: number) => shDate(ts).replace(/-/g, '');
const monthOf = (ts: number) => shDate(ts).slice(0, 7);

/**
 * 租约锁：Blob 没有事务，读改写必须串行。
 * 抢锁用 `onlyIfNew`；释放前比对 token，避免锁过期被抢占后误删别人的锁。
 */
export async function withLock<T>(name: string, fn: () => Promise<T>, ttlMs = 15_000): Promise<T> {
  const key = `lk/${name}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 10_000;

  for (;;) {
    if (await s().put(key, token, { onlyIfNew: true })) break;
    const cur = await s().getText(key);
    const at = Number((cur ?? '').split('-')[0]);
    if (cur && Number.isFinite(at) && Date.now() - at > ttlMs) {
      await s().del(key);
      continue;
    }
    if (Date.now() > deadline) throw new Error(`lock timeout: ${name}`);
    await sleep(20 + Math.floor(Math.random() * 40));
  }

  try {
    return await fn();
  } finally {
    const cur = await s().getText(key);
    if (cur === token) await s().del(key);
  }
}

/**
 * 分配自增 id：读计数器 → 条件写占位 → 回写计数器。
 * 并发时条件写会失败，重试一次基本就能拿到下一个号；不强依赖锁。
 */
async function allocId(kind: string, counterKey: string, claim: (id: number) => Promise<boolean>): Promise<number> {
  let last = 0;
  for (let i = 0; i < 8; i++) {
    const cur = Number((await s().getText(counterKey)) || '0');
    const id = Math.max(cur, last) + 1;
    last = id;
    if (await claim(id)) {
      await s().put(counterKey, String(id));
      return id;
    }
  }
  throw new Error(`allocId failed: ${kind}`);
}

/* -------------------------------- 进程内缓存 -------------------------------- */

let totalsCache: { at: number; value: Totals } | null = null;

let cfgCache: { at: number; map: ConfigKV } | null = null;
const CFG_TTL = 3_000;

const bucketCache = new Map<string, { at: number; rows: OrderSummary[] }>();
const BUCKET_TTL = 3_000;

const mstatCache = new Map<string, { at: number; stat: MonthStat }>();
const MSTAT_TTL = 5_000;

const monthKeysCache: { at: number; keys: string[] } = { at: 0, keys: [] };
const MONTH_KEYS_TTL = 10_000;

const dayKeysCache: { at: number; keys: string[] } = { at: 0, keys: [] };
const DAY_KEYS_TTL = 5_000;

/** 测试 / 本地重置用 */
export function resetRepo(): void {
  resetStore();
  cfgCache = null;
  bucketCache.clear();
  mstatCache.clear();
  monthKeysCache.at = 0;
  dayKeysCache.at = 0;
}

/* ================================== 配置 ================================== */

export async function cfgAll(): Promise<ConfigKV> {
  if (cfgCache && Date.now() - cfgCache.at < CFG_TTL) return cfgCache.map;
  const map = (await readJson<ConfigKV>('cfg')) ?? {};
  cfgCache = { at: Date.now(), map };
  return map;
}

export async function cfgGet(k: string): Promise<string | null> {
  const all = await cfgAll();
  return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null;
}

export async function cfgSet(k: string, v: string): Promise<void> {
  // 配置是读多写少，但登录失败计数、账单轮询时间戳会在请求里写，必须串行
  await withLock('cfg', async () => {
    const map = (await readJson<ConfigKV>('cfg')) ?? {};
    map[k] = v;
    await writeJson('cfg', map);
    cfgCache = { at: Date.now(), map };
  });
}

export async function cfgSetMany(entries: Record<string, string>): Promise<void> {
  await withLock('cfg', async () => {
    const map = (await readJson<ConfigKV>('cfg')) ?? {};
    Object.assign(map, entries);
    await writeJson('cfg', map);
    cfgCache = { at: Date.now(), map };
  });
}

/**
 * 健康检查：验证 Blob 凭据、读写权限与初始化状态。
 * 部署后第一件事就该访问 /api/health，比看 500 页面快得多。
 */
export async function healthCheck(): Promise<{ store: string; initialized: boolean }> {
  const cfg = await cfgAll();
  await s().keys('u/'); // 顺带验证 list 权限
  return { store: s().kind, initialized: !!cfg.admin_user };
}

/* ================================== 商户 ================================== */

export async function userByUid(uid: number): Promise<UserRow | null> {
  if (!uid) return null;
  return await readJson<UserRow>(`u/${uid}`);
}

export async function userByName(username: string): Promise<UserRow | null> {
  const uid = Number((await s().getText(`un/${encodeURIComponent(username)}`)) || '0');
  return uid ? await userByUid(uid) : null;
}

/** 原 SQL: WHERE username=? OR uid=? （邀请人既可能是用户名也可能是 uid） */
export async function userByNameOrUid(username: string, uid: number): Promise<{ uid: number } | null> {
  const byName = await userByName(username);
  if (byName) return { uid: byName.uid };
  const byUid = uid ? await userByUid(uid) : null;
  return byUid ? { uid: byUid.uid } : null;
}

export async function userInsert(input: {
  username: string;
  password: string;
  key: string;
  email?: string;
  invite_uid?: number;
}): Promise<number> {
  const usernameKey = `un/${encodeURIComponent(input.username)}`;
  if (await s().getText(usernameKey)) throw new Error('USERNAME_EXISTS');
  // 先占 `u/<uid>` 再写用户名索引：uid 冲突时条件写会失败并自动换号，
  // 不会出现两个商户拿到同一个 uid
  const uid = await allocId('user', 'uctr', async (id) => await s().put(`u/${id}`, '{}', { onlyIfNew: true }));
  const row: UserRow = {
    uid,
    gid: 1,
    username: input.username,
    email: input.email ?? '',
    password: input.password,
    key: input.key,
    money: 0,
    mode: 1,
    status: 1,
    regtime: now(),
    keytype: 0,
    publickey: '',
    domain: '',
    invite_uid: input.invite_uid ?? 0,
    cert: 0,
    cert_name: '',
    cert_no: '',
  };
  await writeJson(`u/${uid}`, row);
  await s().put(usernameKey, String(uid));
  userKeysCache = null;
  return uid;
}

export async function userPatch(uid: number, patch: Partial<UserRow>): Promise<void> {
  await withLock(`u/${uid}`, async () => {
    const row = await readJson<UserRow>(`u/${uid}`);
    if (!row) return;
    await writeJson(`u/${uid}`, { ...row, ...patch, uid });
  });
}

/** 余额改动；delta 为负时要求余额足够（等价于 `WHERE money>=?`），返回是否成功 */
export async function userAddMoney(uid: number, delta: number): Promise<boolean> {
  return await withLock(`u/${uid}`, async () => {
    const row = await readJson<UserRow>(`u/${uid}`);
    if (!row) return false;
    const next = (row.money || 0) + delta;
    if (next < 0) return false;
    row.money = next;
    await writeJson(`u/${uid}`, row);
    return true;
  });
}

export async function userSetMoney(uid: number, money: number): Promise<void> {
  await userPatch(uid, { money });
}

let userKeysCache: { at: number; ids: number[] } | null = null;
const USER_KEYS_TTL = 5_000;

async function allUserKeys(): Promise<number[]> {
  if (userKeysCache && Date.now() - userKeysCache.at < USER_KEYS_TTL) return userKeysCache.ids;
  const keys = await s().keys('u/');
  const ids = keys
    .map((k) => Number(k.slice(2)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  userKeysCache = { at: Date.now(), ids };
  return ids;
}

async function usersByKeys(keys: number[]): Promise<UserRow[]> {
  const rows = await Promise.all(keys.map((uid) => readJson<UserRow>(`u/${uid}`)));
  return rows.filter((r): r is UserRow => !!r);
}

export async function userCount(): Promise<number> {
  return (await allUserKeys()).length;
}

export async function userList(offset: number, limit: number): Promise<UserRow[]> {
  const ids = (await allUserKeys()).slice(offset, offset + limit);
  return await usersByKeys(ids);
}

export async function usersByCert(cert: number): Promise<UserRow[]> {
  const rows = await usersByKeys(await allUserKeys());
  return rows.filter((r) => (r.cert || 0) === cert).sort((a, b) => a.uid - b.uid);
}

export async function usersByGid(gid: number): Promise<number[]> {
  const rows = await usersByKeys(await allUserKeys());
  return rows.filter((r) => r.gid === gid).map((r) => r.uid);
}

export async function usersByIds(ids: number[]): Promise<Map<number, UserRow>> {
  const uniq = [...new Set(ids)];
  const rows = await usersByKeys(uniq);
  return new Map(rows.map((r) => [r.uid, r]));
}

export async function userDelete(uid: number): Promise<void> {
  const row = await readJson<UserRow>(`u/${uid}`);
  if (!row) return;
  await s().del(`un/${encodeURIComponent(row.username)}`);
  await s().del(`u/${uid}`);
  userKeysCache = null;
}

/* ================================== 渠道 ================================== */

export async function channelAll(): Promise<ChannelRow[]> {
  const keys = await s().keys('ch/');
  const rows = await Promise.all(keys.map((k) => readJson<ChannelRow>(k)));
  return rows
    .filter((r): r is ChannelRow => !!r)
    .sort((a, b) => a.id - b.id);
}

export async function channelGet(id: number): Promise<ChannelRow | null> {
  if (!id) return null;
  return await readJson<ChannelRow>(`ch/${id}`);
}

export async function channelByIds(ids: number[], onlyActive = false): Promise<ChannelRow[]> {
  const rows = await Promise.all(ids.map((id) => channelGet(id)));
  return rows.filter((r): r is ChannelRow => !!r && (!onlyActive || r.status === 1));
}

export async function channelByPlugin(plugin: string, onlyActive = false): Promise<ChannelRow[]> {
  return (await channelAll()).filter((c) => c.plugin === plugin && (!onlyActive || c.status === 1));
}

export async function channelByPlugins(plugins: string[], onlyActive = false): Promise<ChannelRow[]> {
  return (await channelAll()).filter((c) => plugins.includes(c.plugin) && (!onlyActive || c.status === 1));
}

export async function channelSave(input: {
  id?: number;
  plugin: string;
  name: string;
  status?: number;
  config: string;
  types: string;
  weight?: number;
}): Promise<number> {
  const row = {
    plugin: input.plugin,
    name: input.name,
    status: input.status === 0 ? 0 : 1,
    config: input.config,
    types: input.types,
    weight: Math.max(1, input.weight || 1),
  };
  if (input.id) {
    await writeJson(`ch/${input.id}`, { id: input.id, ...row });
    return input.id;
  }
  let created = 0;
  await allocId('channel', 'chctr', async (nid) => {
    created = nid;
    return await s().put(`ch/${nid}`, JSON.stringify({ id: nid, ...row }), { onlyIfNew: true });
  });
  return created;
}

export async function channelDelete(id: number): Promise<void> {
  await s().del(`ch/${id}`);
}

/* ================================== 分组 ================================== */

/**
 * 等价于 migrate-v2.sql 里的 `INSERT INTO groups (id,name,rate) SELECT 1,'默认分组',0 ...`。
 * D1 版靠建表脚本保证 id=1 永远是默认分组；Blob 版没有建表步骤，
 * 必须在初始化时补一条，否则后台新建的第一个分组会占用 id=1，
 * 把「默认分组」顶掉 —— 所有 gid=1 的商户会被套上那个分组的费率。
 */
export async function ensureDefaultGroup(): Promise<void> {
  const cur = await readJson<GroupRow>('g/1');
  if (!cur) await writeJson('g/1', { id: 1, name: '默认分组', rate: 0 });
}

export async function groupAll(): Promise<GroupRow[]> {
  const keys = await s().keys('g/');
  const rows = await Promise.all(keys.map((k) => readJson<GroupRow>(k)));
  return rows
    .filter((r): r is GroupRow => !!r)
    .sort((a, b) => a.id - b.id);
}

export async function groupGet(id: number): Promise<GroupRow | null> {
  return await readJson<GroupRow>(`g/${id}`);
}

export async function groupSave(input: { id?: number; name: string; rate: number }): Promise<number> {
  if (input.id) {
    await writeJson(`g/${input.id}`, { id: input.id, name: input.name, rate: input.rate });
    return input.id;
  }
  let created = 0;
  await allocId('group', 'gctr', async (nid) => {
    created = nid;
    return await s().put(`g/${nid}`, JSON.stringify({ id: nid, name: input.name, rate: input.rate }), {
      onlyIfNew: true,
    });
  });
  return created;
}

export async function groupDelete(id: number): Promise<void> {
  await s().del(`g/${id}`);
}

/* ================================ 订单索引 ================================ */

async function dayKeysDesc(): Promise<string[]> {
  if (Date.now() - dayKeysCache.at < DAY_KEYS_TTL && dayKeysCache.keys.length) return dayKeysCache.keys;
  const keys = (await s().keys('oidx/')).sort().reverse();
  dayKeysCache.at = Date.now();
  dayKeysCache.keys = keys;
  return keys;
}

async function getBucket(dayKey: string): Promise<OrderSummary[]> {
  const hit = bucketCache.get(dayKey);
  if (hit && Date.now() - hit.at < BUCKET_TTL) return hit.rows;
  const rows = (await readJson<OrderSummary[]>(`oidx/${dayKey}`)) ?? [];
  bucketCache.set(dayKey, { at: Date.now(), rows });
  return rows;
}

async function putBucket(dayKey: string, rows: OrderSummary[]): Promise<void> {
  await writeJson(`oidx/${dayKey}`, rows);
  bucketCache.set(dayKey, { at: Date.now(), rows });
}

export function summarize(o: OrderRow): OrderSummary {
  const { ext, ...rest } = o;
  return rest;
}

/** 从 ext 提取唯一尾数，落到摘要上，供「按金额匹配待支付单」使用 */
function payFieldsOf(ext: string): { pay_amount?: string; pay_sun?: number } {
  try {
    const parsed = JSON.parse(ext || '{}') as { pay_amount?: string; pay_sun?: number };
    const out: { pay_amount?: string; pay_sun?: number } = {};
    if (parsed.pay_amount) out.pay_amount = String(parsed.pay_amount);
    if (typeof parsed.pay_sun === 'number') out.pay_sun = parsed.pay_sun;
    return out;
  } catch {
    return {};
  }
}

/* --------------------------------- 月统计 --------------------------------- */

async function monthKeysAsc(): Promise<string[]> {
  if (Date.now() - monthKeysCache.at < MONTH_KEYS_TTL && monthKeysCache.keys.length) return monthKeysCache.keys;
  const keys = (await s().keys('mstat/')).map((k) => k.slice('mstat/'.length)).sort();
  monthKeysCache.at = Date.now();
  monthKeysCache.keys = keys;
  return keys;
}

function emptyMonth(): MonthStat {
  return { n: 0, sum: 0, st: [0, 0, 0, 0], days: {}, users: {} };
}

async function getMonth(month: string): Promise<MonthStat> {
  const hit = mstatCache.get(month);
  if (hit && Date.now() - hit.at < MSTAT_TTL) return hit.stat;
  const stat = (await readJson<MonthStat>(`mstat/${month}`)) ?? emptyMonth();
  mstatCache.set(month, { at: Date.now(), stat });
  return stat;
}

/**
 * 更新月度统计。`was` / `is` 是状态迁移前后的值；只在「0 → 已支付」时累计金额，
 * 与 `SUM(money) WHERE status>=1` 口径一致。
 */
async function bumpMonth(
  month: string,
  input: { created?: OrderSummary; from?: number; to?: { status: number; money: number; addtime: number | null } }
): Promise<void> {
  await withLock(`ms/${month}`, async () => {
    const stat = (await readJson<MonthStat>(`mstat/${month}`)) ?? emptyMonth();
    if (input.created) {
      const o = input.created;
      const day = shDate(o.addtime || now()).slice(8, 10);
      stat.n += 1;
      stat.st[0] += 1;
      stat.days[day] = stat.days[day] || { n: 0, sum: 0 };
      stat.days[day].n += 1;
      stat.users[String(o.uid)] = (stat.users[String(o.uid)] || 0) + 1;
    }
    if (input.to) {
      const o = input.to;
      const from = Math.min(3, Math.max(0, input.from ?? 0));
      const to = Math.min(3, Math.max(0, o.status));
      if (from !== to) {
        stat.st[from] = Math.max(0, (stat.st[from] || 0) - 1);
        stat.st[to] = (stat.st[to] || 0) + 1;
        if (from < 1 && to >= 1) {
          const day = shDate(o.addtime || now()).slice(8, 10);
          stat.sum += o.money;
          stat.days[day] = stat.days[day] || { n: 0, sum: 0 };
          stat.days[day].sum += o.money;
        }
      }
    }
    await writeJson(`mstat/${month}`, stat);
    mstatCache.set(month, { at: Date.now(), stat });
    monthKeysCache.at = 0;
    totalsCache = null;
  });
}

/* --------------------------------- 订单写 --------------------------------- */

/**
 * 支付幂等标记。同一笔订单只允许一次「待支付 → 已支付」的流转，
 * 用 Blob 的条件写代替 D1 的 `UPDATE ... WHERE status=0` 受影响行数。
 */
export async function claimPaid(tradeNo: string): Promise<boolean> {
  return await s().put(`paid/${tradeNo}`, String(now()), { onlyIfNew: true });
}

export async function releasePaid(tradeNo: string): Promise<void> {
  await s().del(`paid/${tradeNo}`);
}

export interface OrderCreateInput {
  trade_no: string;
  out_trade_no: string;
  uid: number;
  type: string;
  channel: number | null;
  name: string;
  money: number;
  addtime: number;
  notify_url: string;
  return_url: string;
  domain: string;
  ip: string;
}

export async function orderCreate(input: OrderCreateInput): Promise<OrderRow> {
  const id = await allocId('order', 'octr', async (nid) =>
    await s().put(`oi/${nid}`, input.trade_no, { onlyIfNew: true })
  );
  const row: OrderRow = {
    id,
    trade_no: input.trade_no,
    out_trade_no: input.out_trade_no,
    uid: input.uid,
    type: input.type,
    channel: input.channel,
    name: input.name,
    money: input.money,
    realmoney: 0,
    status: 0,
    addtime: input.addtime,
    endtime: null,
    notify_url: input.notify_url,
    return_url: input.return_url,
    domain: input.domain,
    ip: input.ip,
    api_trade_no: '',
    notify_count: 0,
    notify_status: 0,
    ext: '{}',
  };

  // trade_no 冲突（时间戳+6位随机，概率极低）时换一个重试
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    ok = await s().put(`o/${row.trade_no}`, JSON.stringify(row), { onlyIfNew: true });
    if (!ok) row.trade_no = `${row.trade_no.slice(0, 14)}${Math.floor(Math.random() * 900000) + 100000}`;
  }
  if (!ok) throw new Error('trade_no 冲突');

  const summary = summarize(row);
  const dayKey = dayBucketOf(row.addtime || now());
  await withLock(`d/${dayKey}`, async () => {
    const rows = (await readJson<OrderSummary[]>(`oidx/${dayKey}`)) ?? [];
    rows.push(summary);
    await putBucket(dayKey, rows);
    dayKeysCache.at = 0;
  });
  await mutatePending((rows) => [...rows.filter((r) => r.id !== row.id), summary]);
  await bumpMonth(monthOf(row.addtime || now()), { created: summary });
  return row;
}

/* --------------------------------- 订单读 --------------------------------- */

export async function orderByTradeNo(tradeNo: string): Promise<OrderRow | null> {
  if (!tradeNo) return null;
  return await readJson<OrderRow>(`o/${tradeNo}`);
}

export async function orderById(id: number): Promise<OrderRow | null> {
  if (!id) return null;
  const tradeNo = await s().getText(`oi/${id}`);
  return tradeNo ? await orderByTradeNo(tradeNo) : null;
}

export async function orderByApiTradeNo(apiTradeNo: string): Promise<OrderRow | null> {
  if (!apiTradeNo) return null;
  const tradeNo = await s().getText(`oapi/${encodeURIComponent(apiTradeNo)}`);
  return tradeNo ? await orderByTradeNo(tradeNo) : null;
}

/**
 * 待支付队列放在一个文档里而不是「一单一个 key」：金额匹配（尾数防撞单、账单轮询、
 * onebot/vmq 推送）每一笔都要读一遍待支付集合，逐 key 读会变成 N 次 Blob 往返。
 * 单文档 = 一次读；个人收款量级下待支付单通常只有几十条。
 */
async function pendingSummaries(): Promise<OrderSummary[]> {
  const rows = (await readJson<OrderSummary[]>('pend')) ?? [];
  return rows.sort((a, b) => (a.id || 0) - (b.id || 0));
}

async function mutatePending(fn: (rows: OrderSummary[]) => OrderSummary[]): Promise<void> {
  await withLock('pend', async () => {
    const rows = (await readJson<OrderSummary[]>('pend')) ?? [];
    const next = fn(rows);
    await writeJson('pend', next);
  });
}

export interface PendingQuery {
  type?: string;
  channelIds?: number[];
  /** 只要 addtime 落在 [from, to] 的（秒） */
  from?: number;
  to?: number;
  order?: 'asc' | 'desc';
  limit?: number;
}

/**
 * 待支付订单查询。原实现都是 `WHERE status=0 ... ORDER BY id`，
 * 这里直接走待支付队列，不需要按天扫。
 */
export async function orderListPending(q: PendingQuery = {}): Promise<OrderSummary[]> {
  let rows = await pendingSummaries();
  if (q.type) rows = rows.filter((r) => r.type === q.type);
  if (q.channelIds) {
    const set = new Set(q.channelIds);
    rows = rows.filter((r) => r.channel !== null && set.has(r.channel as number));
  }
  if (q.from !== undefined) rows = rows.filter((r) => (r.addtime || 0) >= q.from!);
  if (q.to !== undefined) rows = rows.filter((r) => (r.addtime || 0) <= q.to!);
  if (q.order === 'desc') rows.reverse();
  if (q.limit !== undefined) rows = rows.slice(0, q.limit);
  return rows;
}

async function patchOrderRow(tradeNo: string, patch: Partial<OrderRow>, expect?: (o: OrderRow) => boolean) {
  return await withLock(`o/${tradeNo}`, async () => {
    const row = await readJson<OrderRow>(`o/${tradeNo}`);
    if (!row) return { ok: false as const, before: null as OrderRow | null, after: null as OrderRow | null };
    if (expect && !expect(row)) return { ok: false as const, before: row, after: null };
    const next: OrderRow = { ...row, ...patch, id: row.id, trade_no: row.trade_no };
    await writeJson(`o/${tradeNo}`, next);
    return { ok: true as const, before: row, after: next };
  });
}

/** 派生索引（日桶 / 月统计 / 待支付）跟随订单一起更新 */
async function syncDerived(before: OrderRow | null, after: OrderRow): Promise<void> {
  const summary = summarize({ ...after, ...payFieldsOf(after.ext) });
  const dayKey = dayBucketOf(after.addtime || now());

  await withLock(`d/${dayKey}`, async () => {
    const rows = (await readJson<OrderSummary[]>(`oidx/${dayKey}`)) ?? [];
    const idx = rows.findIndex((r) => r.id === after.id);
    if (idx >= 0) rows[idx] = summary;
    else rows.push(summary);
    await putBucket(dayKey, rows);
  });

  await mutatePending((rows) => {
    const rest = rows.filter((r) => r.id !== after.id);
    return after.status === 0 ? [...rest, summary] : rest;
  });
  if (after.api_trade_no) await s().put(`oapi/${encodeURIComponent(after.api_trade_no)}`, after.trade_no);

  // 状态没变时（改 ext / 改回调计数）不必动月度统计
  if (before?.status !== after.status) {
    await bumpMonth(monthOf(after.addtime || now()), {
      from: before?.status ?? after.status,
      to: { status: after.status, money: after.money, addtime: after.addtime },
    });
  }
}

export async function orderPatch(
  tradeNo: string,
  patch: Partial<OrderRow>,
  expect?: (o: OrderRow) => boolean
): Promise<boolean> {
  const r = await patchOrderRow(tradeNo, patch, expect);
  if (!r.ok || !r.after) return false;
  await syncDerived(r.before, r.after);
  return true;
}

/** 写 ext（唯一尾数金额），同时把尾数同步进摘要，供金额匹配使用 */
export async function orderSetExt(tradeNo: string, ext: string): Promise<void> {
  await orderPatch(tradeNo, { ext });
}

/** 回调结果记账：成功置 notify_status=1，失败累加 notify_count */
export async function orderBumpNotify(
  tradeNo: string,
  input: { notify_status?: number; notify_count_delta?: number }
): Promise<void> {
  const r = await withLock(`o/${tradeNo}`, async () => {
    const row = await readJson<OrderRow>(`o/${tradeNo}`);
    if (!row) return null;
    const next: OrderRow = {
      ...row,
      notify_status: input.notify_status ?? row.notify_status,
      notify_count: (row.notify_count || 0) + (input.notify_count_delta || 0),
    };
    await writeJson(`o/${tradeNo}`, next);
    return { before: row, after: next };
  });
  if (r) await syncDerived(r.before, r.after);
}

export interface OrderPage {
  list: OrderSummary[];
  total: number;
}

/** 后台订单列表：status 过滤 + 关键词（trade_no / out_trade_no 模糊、uid 精确） */
export async function orderListAdmin(opts: {
  page: number;
  size: number;
  status?: number | null;
  q?: string;
}): Promise<OrderPage> {
  const { page, size } = opts;
  const offset = (page - 1) * size;
  const q = (opts.q || '').trim();
  const qUid = parseInt(q, 10) || 0;
  const match = (r: OrderSummary): boolean => {
    if (opts.status !== undefined && opts.status !== null && r.status !== opts.status) return false;
    if (!q) return true;
    return (
      (r.trade_no || '').includes(q) ||
      (r.out_trade_no || '').includes(q) ||
      (qUid > 0 && r.uid === qUid)
    );
  };

  const out: OrderSummary[] = [];
  let matched = 0;
  const fullScan = !!q; // 关键词搜索要算总数，只能扫完
  for (const key of await dayKeysDesc()) {
    const rows = await getBucket(key.replace('oidx/', ''));
    const hit = rows.filter(match).sort((a, b) => (b.id || 0) - (a.id || 0));
    for (const r of hit) {
      matched++;
      if (matched > offset && out.length < size) out.push(r);
    }
    if (!fullScan && out.length >= size) break;
  }

  let total: number;
  if (q) {
    total = matched;
  } else if (opts.status !== undefined && opts.status !== null) {
    total = 0;
    for (const m of await monthKeysAsc()) total += (await getMonth(m)).st[opts.status] || 0;
  } else {
    total = (await statTotals()).orders;
  }
  return { list: out, total };
}

/** 商户中心订单列表（自己看自己） */
export async function orderListUser(uid: number, page: number, size = 20): Promise<OrderPage> {
  const offset = (page - 1) * size;
  const out: OrderSummary[] = [];
  if (offset < 0) return { list: [], total: await userOrderCount(uid) };
  let matched = 0;
  for (const key of await dayKeysDesc()) {
    const rows = await getBucket(key.replace('oidx/', ''));
    const mine = rows.filter((r) => r.uid === uid).sort((a, b) => (b.id || 0) - (a.id || 0));
    for (const r of mine) {
      matched++;
      if (matched > offset && out.length < size) out.push(r);
    }
    if (out.length >= size) break;
  }
  return { list: out, total: await userOrderCount(uid) };
}

async function userOrderCount(uid: number): Promise<number> {
  let n = 0;
  for (const m of await monthKeysAsc()) n += (await getMonth(m)).users[String(uid)] || 0;
  return n;
}

/** 需要重试商户通知的订单（status>=1 且未成功，次数 < 5），新的优先 */
export async function orderListNotifyRetry(limit: number): Promise<OrderSummary[]> {
  const out: OrderSummary[] = [];
  for (const key of await dayKeysDesc()) {
    const rows = await getBucket(key.replace('oidx/', ''));
    const hit = rows
      .filter((r) => r.status >= 1 && r.notify_status === 0 && !!r.notify_url && (r.notify_count || 0) < 5)
      .sort((a, b) => (b.id || 0) - (a.id || 0));
    for (const r of hit) {
      out.push(r);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** 导出 / 按 IP 统计：按时间正序吐摘要 */
export async function orderSummariesSince(since: number, limit = 5000): Promise<OrderSummary[]> {
  const out: OrderSummary[] = [];
  const days = (await dayKeysDesc()).reverse();
  for (const key of days) {
    const rows = await getBucket(key.replace('oidx/', ''));
    for (const r of rows) {
      if ((r.addtime || 0) < since) continue;
      out.push(r);
    }
  }
  return out.sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, limit);
}

/** 所有已支付订单摘要（按 IP 聚合用），可按时间窗限制 */
export async function orderSummariesPaid(since = 0): Promise<OrderSummary[]> {
  const out: OrderSummary[] = [];
  for (const key of await dayKeysDesc()) {
    const rows = await getBucket(key.replace('oidx/', ''));
    for (const r of rows) {
      if (r.status >= 1 && (r.addtime || 0) >= since) out.push(r);
    }
  }
  return out;
}

/* --------------------------------- 统计 --------------------------------- */

export interface Totals {
  orders: number;
  pending: number;
  paidSum: number;
  paidCount: number;
}

export async function statTotals(): Promise<Totals> {
  if (totalsCache && Date.now() - totalsCache.at < 5_000) return totalsCache.value;
  const value: Totals = { orders: 0, pending: 0, paidSum: 0, paidCount: 0 };
  for (const m of await monthKeysAsc()) {
    const stat = await getMonth(m);
    value.orders += stat.n;
    value.pending += stat.st[0] || 0;
    value.paidSum += stat.sum;
    value.paidCount += (stat.st[1] || 0) + (stat.st[3] || 0);
  }
  totalsCache = { at: Date.now(), value };
  return value;
}

/** 上海时区「今天 0 点」的时间戳 */
export function shanghaiMidnight(ts = now()): number {
  const d = new Date((ts + 8 * 3600) * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000) - 8 * 3600;
}

/** 某一天的（上海时区）单量与已支付金额 */
export async function statDay(day: string): Promise<{ n: number; sum: number }> {
  const stat = await getMonth(day.slice(0, 7));
  return stat.days[day.slice(8, 10)] || { n: 0, sum: 0 };
}

/** 最近 N 天的走势（含今天），缺的天补 0 */
export async function statDailySeries(days: number): Promise<Array<{ d: string; n: number; s: number }>> {
  const out: Array<{ d: string; n: number; s: number }> = [];
  const base = now();
  for (let i = days - 1; i >= 0; i--) {
    const day = shDate(base - i * 86400);
    const cell = await statDay(day);
    out.push({ d: day, n: cell.n, s: cell.sum });
  }
  return out;
}

/** 滚动窗口统计：直接扫日桶，保证与 `addtime>=now-86400` 完全一致 */
export async function statWindow(from: number): Promise<{ n: number; sum: number }> {
  let n = 0;
  let sum = 0;
  for (const key of await dayKeysDesc()) {
    const day = key.slice('oidx/'.length); // YYYYMMDD
    const start =
      Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))) / 1000 - 8 * 3600;
    if (start + 86400 <= from) break; // 日桶按日期倒序，整桶都早于窗口即可停
    const rows = await getBucket(day);
    for (const r of rows) {
      if ((r.addtime || 0) < from) continue;
      n++;
      if (r.status >= 1) sum += r.money;
    }
  }
  return { n, sum };
}

/* ================================== 流水 ================================== */

export async function recordAdd(uid: number, type: number, money: number, note: string): Promise<number> {
  const at = now();
  let created = 0;
  await allocId('record', 'rctr', async (nid) => {
    created = nid;
    const row: RecordRow = { id: nid, uid, type, money, addtime: at, note };
    return await s().put(`rc/${uid}/${pad(nid)}`, JSON.stringify(row), { onlyIfNew: true });
  });
  return created;
}

export async function recordList(uid: number, limit = 50): Promise<RecordRow[]> {
  const keys = (await s().keys(`rc/${uid}/`)).sort().reverse().slice(0, limit);
  const rows = await Promise.all(keys.map((k) => readJson<RecordRow>(k)));
  return rows.filter((r): r is RecordRow => !!r);
}

/* ================================== 结算 ================================== */

export async function settleAdd(uid: number, amount: number): Promise<number> {
  const at = now();
  let created = 0;
  await allocId('settle', 'stctr', async (nid) => {
    created = nid;
    const row: SettleRow = { id: nid, uid, amount, addtime: at, status: 0, note: '' };
    return await s().put(`st/${pad(nid)}`, JSON.stringify(row), { onlyIfNew: true });
  });
  return created;
}

export async function settleGet(id: number): Promise<SettleRow | null> {
  return await readJson<SettleRow>(`st/${pad(id)}`);
}

export async function settlePatch(id: number, patch: Partial<SettleRow>): Promise<void> {
  const row = await settleGet(id);
  if (!row) return;
  await writeJson(`st/${pad(id)}`, { ...row, ...patch, id });
}

export async function settleList(limit = 100): Promise<SettleWithUser[]> {
  const keys = (await s().keys('st/')).sort().reverse().slice(0, limit);
  const rows = (await Promise.all(keys.map((k) => readJson<SettleRow>(k)))).filter((r): r is SettleRow => !!r);
  const users = await usersByIds(rows.map((r) => r.uid));
  return rows.map((r) => ({ ...r, username: users.get(r.uid)?.username || '' }));
}

export async function settleCountPending(): Promise<number> {
  const keys = await s().keys('st/');
  const rows = await Promise.all(keys.map((k) => readJson<SettleRow>(k)));
  return rows.filter((r) => r && r.status === 0).length;
}

/* ================================= 验证码 ================================= */

export async function regGet(key: string): Promise<{ v: string; time: number } | null> {
  return await readJson<{ v: string; time: number }>(`rg/${encodeURIComponent(key)}`);
}

export async function regSet(key: string, v: string, time: number): Promise<void> {
  await writeJson(`rg/${encodeURIComponent(key)}`, { v, time });
}

export async function regDel(key: string): Promise<void> {
  await s().del(`rg/${encodeURIComponent(key)}`);
}

export async function regCleanup(before: number): Promise<void> {
  const keys = await s().keys('rg/');
  const rows = await Promise.all(keys.map(async (k) => [k, await readJson<{ time: number }>(k)] as const));
  for (const [k, row] of rows) {
    if (!row || (row.time || 0) < before) await s().del(k);
  }
}
