import { Hono } from 'hono';
import { Bindings, getCookie, makeSessionCookie, parseSessionCookie, verifyPassword, hashPassword } from '../lib/auth';
import { getConfig, getConfigAll, setConfig, markOrderRefunded } from '../lib/db';
import { randomStr, now } from '../lib/util';
import { listPlugins } from '../lib/channel';
import {
  channelAll,
  channelDelete,
  channelSave,
  orderListAdmin,
  recordAdd,
  settleCountPending,
  settleGet,
  settleList,
  settlePatch,
  statDay,
  statTotals,
  shanghaiMidnight,
  shDate,
  userAddMoney,
  userByName,
  userCount,
  userDelete,
  userInsert,
  userList,
  userPatch,
  cfgSetMany,
} from '../lib/repo';

export const admin = new Hono<{ Bindings: Bindings }>();

async function requireLogin(env: Bindings, req: Request): Promise<boolean> {
  const syskey = (await getConfig('syskey')) || '';
  const session = await parseSessionCookie(env, syskey, getCookie(req, 'epay_session'));
  return session?.role === 'admin';
}

const OPEN_PATHS = ['/admin/api/login', '/admin/api/logout', '/admin/api/islogin'];
admin.use('/api/*', async (c, next) => {
  if (OPEN_PATHS.includes(c.req.path)) return next();
  if (!(await requireLogin(c.env, c.req.raw))) return c.json({ code: 403, msg: '未登录' }, 403);
  await next();
});

// ---------- 登录 ----------
admin.post('/api/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  const conf = await getConfigAll();
  const failRaw = conf.login_fail || '{"n":0,"t":0}';
  let fail = { n: 0, t: 0 };
  try {
    fail = JSON.parse(failRaw);
  } catch {}
  if (fail.n >= 10 && now() - fail.t < 600) {
    return c.json({ code: -1, msg: '失败次数过多，请10分钟后再试' });
  }
  const adminUser = conf.admin_user || '';
  const adminPwd = conf.admin_pwd || '';
  if (!adminUser || !adminPwd) return c.json({ code: -1, msg: '系统未初始化' });
  if (username !== adminUser || !(await verifyPassword(password, adminPwd))) {
    const n = now() - fail.t < 600 ? fail.n + 1 : 1;
    await setConfig('login_fail', JSON.stringify({ n, t: now() }));
    return c.json({ code: -1, msg: '账号或密码错误' });
  }
  await setConfig('login_fail', '{"n":0,"t":0}');
  const syskey = conf.syskey || '';
  const cookie = await makeSessionCookie(c.env, syskey, { role: 'admin', id: 0 });
  c.header('Set-Cookie', `epay_session=${cookie}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
  return c.json({ code: 0 });
});

admin.post('/api/logout', (c) => {
  c.header('Set-Cookie', 'epay_session=; Path=/; HttpOnly; Max-Age=0');
  return c.json({ code: 0 });
});

admin.get('/api/islogin', async (c) => {
  return c.json({ code: 0, login: await requireLogin(c.env, c.req.raw) });
});

// ---------- 概览 ----------
admin.get('/api/info', async (c) => {
  // 原实现按 Asia/Shanghai 的「今天 0 点」切分
  const today = shDate(shanghaiMidnight());
  const day = await statDay(today);
  const totals = await statTotals();
  return c.json({
    code: 0,
    data: {
      orders_today: day.n,
      money_today: day.sum,
      pending: totals.pending,
      users: await userCount(),
      orders_all: totals.orders,
      settles_pending: await settleCountPending(),
      sitename: (await getConfig('sitename')) || '',
    },
  });
});

// ---------- 订单 ----------
admin.get('/api/orders', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const size = Math.min(100, parseInt(c.req.query('size') || '20', 10));
  const statusRaw = c.req.query('status');
  const q = (c.req.query('q') || '').trim();
  const status = statusRaw === undefined || statusRaw === '' ? null : parseInt(statusRaw, 10);
  const { list, total } = await orderListAdmin({ page, size, status, q });
  return c.json({ code: 0, data: { list, total } });
});

admin.post('/api/orders/refund', async (c) => {
  const { trade_no } = await c.req.json<{ trade_no: string }>();
  const r = await markOrderRefunded(c.env, trade_no);
  return c.json({ code: r.ok ? 0 : -1, msg: r.msg });
});

// ---------- 渠道 ----------
admin.get('/api/channels', async (c) => {
  const results = await channelAll();
  return c.json({
    code: 0,
    data: {
      list: results,
      plugins: listPlugins().map((p) => ({
        id: p.id,
        name: p.name,
        types: p.types,
        inputs: p.inputs,
        help: p.help,
      })),
    },
  });
});

admin.post('/api/channels', async (c) => {
  const b = await c.req.json<{ id?: number; plugin: string; name: string; status?: number; config: string; types: string[]; weight?: number; paymin?: string; paymax?: string }>();
  const plugin = listPlugins().find((p) => p.id === b.plugin);
  if (!plugin) return c.json({ code: -1, msg: '插件不存在' });
  let configObj: Record<string, string> = {};
  try {
    configObj = typeof b.config === 'string' ? JSON.parse(b.config) : (b.config as unknown as Record<string, string>);
  } catch {}
  for (const inp of plugin.inputs) {
    if (inp.required && !configObj[inp.name]) return c.json({ code: -1, msg: `${inp.label} 不能为空` });
  }
  if (b.paymin !== undefined) configObj.paymin = b.paymin;
  if (b.paymax !== undefined) configObj.paymax = b.paymax;
  await channelSave({
    id: b.id,
    plugin: b.plugin,
    name: b.name,
    status: b.status,
    config: JSON.stringify(configObj),
    types: JSON.stringify(b.types || plugin.types),
    weight: b.weight,
  });
  return c.json({ code: 0 });
});

admin.post('/api/channels/delete', async (c) => {
  const { id } = await c.req.json<{ id: number }>();
  await channelDelete(id);
  return c.json({ code: 0 });
});

// ---------- 商户 ----------
admin.get('/api/users', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const rows = await userList((page - 1) * 20, 20);
  // 字段集与原 SELECT 对齐：不返回 password / publickey
  const results = rows.map((u) => ({
    uid: u.uid,
    gid: u.gid,
    username: u.username,
    email: u.email,
    key: u.key,
    money: u.money,
    status: u.status,
    regtime: u.regtime,
    keytype: u.keytype || 0,
    domain: u.domain || '',
    cert: u.cert || 0,
  }));
  return c.json({ code: 0, data: { list: results, total: await userCount() } });
});

admin.post('/api/users', async (c) => {
  const b = await c.req.json<{
    uid?: number; username?: string; password?: string; status?: number; money?: number; reset_key?: boolean;
    keytype?: number; publickey?: string; domain?: string; gid?: number;
  }>();
  if (b.uid) {
    const patch: Record<string, unknown> = {};
    if (b.password) patch.password = await hashPassword(b.password);
    if (b.status !== undefined) patch.status = b.status;
    if (b.money !== undefined) patch.money = Math.round(b.money * 100);
    if (b.reset_key) patch.key = randomStr(32);
    if (b.keytype !== undefined) patch.keytype = b.keytype;
    if (b.publickey !== undefined) patch.publickey = b.publickey;
    if (b.domain !== undefined) patch.domain = b.domain;
    if (b.gid !== undefined) patch.gid = b.gid;
    if (Object.keys(patch).length) await userPatch(b.uid, patch as never);
    return c.json({ code: 0 });
  }
  if (!b.username || !b.password) return c.json({ code: -1, msg: '参数不完整' });
  const dup = await userByName(b.username);
  if (dup) return c.json({ code: -1, msg: '用户名已存在' });
  try {
    await userInsert({ username: b.username, password: await hashPassword(b.password), key: randomStr(32) });
  } catch (e) {
    if (String(e).includes('USERNAME_EXISTS')) return c.json({ code: -1, msg: '用户名已存在' });
    throw e;
  }
  return c.json({ code: 0 });
});

admin.post('/api/users/delete', async (c) => {
  const { uid } = await c.req.json<{ uid: number }>();
  await userDelete(uid);
  return c.json({ code: 0 });
});

// ---------- 配置 / 渠道映射 / 结算 ----------
admin.get('/api/config', async (c) => {
  // 注意：getConfigAll 返回的是进程内缓存的同一个对象，必须拷贝再删字段
  const conf = { ...(await getConfigAll()) };
  delete conf.admin_pwd;
  return c.json({ code: 0, data: conf });
});

admin.post('/api/config', async (c) => {
  const b = await c.req.json<Record<string, string | number>>();
  const patch: Record<string, string> = {};
  for (const k of Object.keys(b)) {
    if (k === 'admin_pwd' || k === 'login_fail') continue;
    if (k === 'admin_user' && !b[k]) continue;
    patch[k] = String(b[k]);
  }
  if (Object.keys(patch).length) await cfgSetMany(patch);
  return c.json({ code: 0 });
});

admin.get('/api/settles', async (c) => {
  const results = await settleList(100);
  return c.json({ code: 0, data: results });
});

admin.post('/api/settles/review', async (c) => {
  const { id, status } = await c.req.json<{ id: number; status: number }>(); // 1 通过(已打款) 2 驳回
  const row = await settleGet(id);
  if (!row) return c.json({ code: -1, msg: '记录不存在' });
  if (row.status !== 0) return c.json({ code: -1, msg: '已处理' });
  await settlePatch(id, { status });
  if (status === 2) {
    await userAddMoney(row.uid, row.amount);
    await recordAdd(row.uid, 3, row.amount, '结算驳回退回');
  }
  return c.json({ code: 0 });
});
