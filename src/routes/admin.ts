import { Hono } from 'hono';
import { Bindings, getCookie, makeSessionCookie, parseSessionCookie, verifyPassword, hashPassword } from '../lib/auth';
import { getConfig, getConfigAll, getUserByUid, setConfig } from '../lib/db';
import { randomHex, randomStr, now } from '../lib/util';
import { listPlugins } from '../lib/channel';
import { markOrderRefunded } from '../lib/db';

export const admin = new Hono<{ Bindings: Bindings }>();

async function requireLogin(env: Bindings, req: Request): Promise<boolean> {
  const syskey = (await getConfig(env.DB, 'syskey')) || '';
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
  const conf = await getConfigAll(c.env.DB);
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
    await setConfig(c.env.DB, 'login_fail', JSON.stringify({ n, t: now() }));
    return c.json({ code: -1, msg: '账号或密码错误' });
  }
  await setConfig(c.env.DB, 'login_fail', '{"n":0,"t":0}');
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
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  today.setHours(0, 0, 0, 0);
  const ts = Math.floor(today.getTime() / 1000);
  const [ordersToday, sumToday, pending, users, ordersAll, settles] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE addtime>=?').bind(ts).first<{ n: number }>(),
    c.env.DB.prepare('SELECT IFNULL(SUM(money),0) s FROM orders WHERE status>=1 AND addtime>=?').bind(ts).first<{ s: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE status=0').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM settles WHERE status=0').first<{ n: number }>(),
  ]);
  return c.json({
    code: 0,
    data: {
      orders_today: ordersToday?.n || 0,
      money_today: sumToday?.s || 0,
      pending: pending?.n || 0,
      users: users?.n || 0,
      orders_all: ordersAll?.n || 0,
      settles_pending: settles?.n || 0,
      sitename: (await getConfig(c.env.DB, 'sitename')) || '',
    },
  });
});

// ---------- 订单 ----------
admin.get('/api/orders', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const size = Math.min(100, parseInt(c.req.query('size') || '20', 10));
  const status = c.req.query('status');
  const q = (c.req.query('q') || '').trim();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status !== undefined && status !== '') {
    where.push('status=?');
    binds.push(parseInt(status, 10));
  }
  if (q) {
    where.push('(trade_no LIKE ? OR out_trade_no LIKE ? OR uid=?)');
    binds.push(`%${q}%`, `%${q}%`, parseInt(q, 10) || 0);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, size, (page - 1) * size)
    .all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) n FROM orders ${w}`)
    .bind(...binds)
    .first<{ n: number }>();
  return c.json({ code: 0, data: { list: results, total: total?.n || 0 } });
});

admin.post('/api/orders/refund', async (c) => {
  const { trade_no } = await c.req.json<{ trade_no: string }>();
  const r = await markOrderRefunded(c.env, trade_no);
  return c.json({ code: r.ok ? 0 : -1, msg: r.msg });
});

// ---------- 渠道 ----------
admin.get('/api/channels', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM channels ORDER BY id').all();
  return c.json({ code: 0, data: { list: results, plugins: listPlugins().map((p) => ({ id: p.id, name: p.name, types: p.types, inputs: p.inputs })) } });
});

admin.post('/api/channels', async (c) => {
  const b = await c.req.json<{ id?: number; plugin: string; name: string; status?: number; config: string; types: string[] }>();
  const plugin = listPlugins().find((p) => p.id === b.plugin);
  if (!plugin) return c.json({ code: -1, msg: '插件不存在' });
  let configObj: Record<string, string> = {};
  try {
    configObj = typeof b.config === 'string' ? JSON.parse(b.config) : b.config;
  } catch {}
  for (const inp of plugin.inputs) {
    if (inp.required && !configObj[inp.name]) return c.json({ code: -1, msg: `${inp.label} 不能为空` });
  }
  if (b.id) {
    await c.env.DB.prepare('UPDATE channels SET plugin=?, name=?, status=?, config=?, types=? WHERE id=?')
      .bind(b.plugin, b.name, b.status === 0 ? 0 : 1, JSON.stringify(configObj), JSON.stringify(b.types || plugin.types), b.id)
      .run();
  } else {
    await c.env.DB.prepare('INSERT INTO channels (plugin, name, status, config, types) VALUES (?,?,?,?,?)')
      .bind(b.plugin, b.name, b.status === 0 ? 0 : 1, JSON.stringify(configObj), JSON.stringify(b.types || plugin.types))
      .run();
  }
  return c.json({ code: 0 });
});

admin.post('/api/channels/delete', async (c) => {
  const { id } = await c.req.json<{ id: number }>();
  await c.env.DB.prepare('DELETE FROM channels WHERE id=?').bind(id).run();
  return c.json({ code: 0 });
});

// ---------- 商户 ----------
admin.get('/api/users', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const { results } = await c.env.DB.prepare('SELECT uid, gid, username, email, key, money, status, regtime FROM users ORDER BY uid LIMIT ? OFFSET ?')
    .bind(20, (page - 1) * 20)
    .all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>();
  return c.json({ code: 0, data: { list: results, total: total?.n || 0 } });
});

admin.post('/api/users', async (c) => {
  const b = await c.req.json<{ uid?: number; username?: string; password?: string; status?: number; money?: number; reset_key?: boolean }>();
  if (b.uid) {
    if (b.password) {
      await c.env.DB.prepare('UPDATE users SET password=? WHERE uid=?').bind(await hashPassword(b.password), b.uid).run();
    }
    if (b.status !== undefined) {
      await c.env.DB.prepare('UPDATE users SET status=? WHERE uid=?').bind(b.status, b.uid).run();
    }
    if (b.money !== undefined) {
      await c.env.DB.prepare('UPDATE users SET money=? WHERE uid=?').bind(Math.round(b.money * 100), b.uid).run();
    }
    if (b.reset_key) {
      await c.env.DB.prepare('UPDATE users SET key=? WHERE uid=?').bind(randomStr(32), b.uid).run();
    }
    return c.json({ code: 0 });
  }
  if (!b.username || !b.password) return c.json({ code: -1, msg: '参数不完整' });
  const dup = await c.env.DB.prepare('SELECT uid FROM users WHERE username=?').bind(b.username).first();
  if (dup) return c.json({ code: -1, msg: '用户名已存在' });
  await c.env.DB.prepare('INSERT INTO users (username, password, key, money, status, regtime) VALUES (?,?,?,?,1,?)')
    .bind(b.username, await hashPassword(b.password), randomStr(32), 0, now())
    .run();
  return c.json({ code: 0 });
});

admin.post('/api/users/delete', async (c) => {
  const { uid } = await c.req.json<{ uid: number }>();
  await c.env.DB.prepare('DELETE FROM users WHERE uid=?').bind(uid).run();
  return c.json({ code: 0 });
});

// ---------- 配置 / 渠道映射 / 结算 ----------
admin.get('/api/config', async (c) => {
  const conf = await getConfigAll(c.env.DB);
  delete conf.admin_pwd;
  return c.json({ code: 0, data: conf });
});

admin.post('/api/config', async (c) => {
  const b = await c.req.json<Record<string, string | number>>();
  for (const k of Object.keys(b)) {
    if (k === 'admin_pwd' || k === 'login_fail') continue;
    if (k === 'admin_user' && !b[k]) continue;
    await setConfig(c.env.DB, k, String(b[k]));
  }
  return c.json({ code: 0 });
});

admin.get('/api/settles', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT s.*, u.username FROM settles s LEFT JOIN users u ON u.uid=s.uid ORDER BY s.id DESC LIMIT 100').all();
  return c.json({ code: 0, data: results });
});

admin.post('/api/settles/review', async (c) => {
  const { id, status } = await c.req.json<{ id: number; status: number }>(); // 1 通过(已打款) 2 驳回
  const row = await c.env.DB.prepare('SELECT * FROM settles WHERE id=?').bind(id).first<{ id: number; uid: number; amount: number; status: number }>();
  if (!row) return c.json({ code: -1, msg: '记录不存在' });
  if (row.status !== 0) return c.json({ code: -1, msg: '已处理' });
  await c.env.DB.prepare('UPDATE settles SET status=? WHERE id=?').bind(status, id).run();
  if (status === 2) {
    await c.env.DB.prepare('UPDATE users SET money=money+? WHERE uid=?').bind(row.amount, row.uid).run();
    await c.env.DB.prepare('INSERT INTO records (uid, type, money, addtime, note) VALUES (?,3,?,?,?)')
      .bind(row.uid, row.amount, now(), '结算驳回退回')
      .run();
  }
  return c.json({ code: 0 });
});
