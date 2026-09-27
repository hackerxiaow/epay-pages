import { Hono } from 'hono';
import { Bindings, getCookie, hashPassword, makeSessionCookie, parseSessionCookie, verifyPassword } from '../lib/auth';
import { getConfig, getConfigAll, setConfig, UserRow } from '../lib/db';
import { randomStr, now } from '../lib/util';

export const user = new Hono<{ Bindings: Bindings }>();

async function currentUser(env: Bindings, req: Request): Promise<UserRow | null> {
  const syskey = (await getConfig(env.DB, 'syskey')) || '';
  const session = await parseSessionCookie(env, syskey, getCookie(req, 'epay_session'));
  if (session?.role !== 'user') return null;
  return await env.DB.prepare('SELECT * FROM users WHERE uid=?').bind(session.uid!).first<UserRow>();
}

user.use('/api/me', async (c, next) => {
  const u = await currentUser(c.env, c.req.raw);
  if (!u) return c.json({ code: 403, msg: '未登录' }, 403);
  c.set('userRow' as never, u as never);
  await next();
});
user.use('/api/orders', async (c, next) => {
  const u = await currentUser(c.env, c.req.raw);
  if (!u) return c.json({ code: 403, msg: '未登录' }, 403);
  c.set('userRow' as never, u as never);
  await next();
});
user.use('/api/settle', async (c, next) => {
  const u = await currentUser(c.env, c.req.raw);
  if (!u) return c.json({ code: 403, msg: '未登录' }, 403);
  c.set('userRow' as never, u as never);
  await next();
});
user.use('/api/records', async (c, next) => {
  const u = await currentUser(c.env, c.req.raw);
  if (!u) return c.json({ code: 403, msg: '未登录' }, 403);
  c.set('userRow' as never, u as never);
  await next();
});

// ---------- 注册 / 登录 ----------
user.post('/api/register', async (c) => {
  const conf = await getConfigAll(c.env.DB);
  if (conf.reg_open !== '1') return c.json({ code: -1, msg: '当前未开放注册' });
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password || password.length < 6) return c.json({ code: -1, msg: '参数不完整或密码过短' });
  if (!/^[a-zA-Z0-9_@.]{3,32}$/.test(username)) return c.json({ code: -1, msg: '用户名格式错误' });
  const dup = await c.env.DB.prepare('SELECT uid FROM users WHERE username=?').bind(username).first();
  if (dup) return c.json({ code: -1, msg: '用户名已存在' });
  const key = randomStr(32);
  const r = await c.env.DB.prepare('INSERT INTO users (username, password, key, money, status, regtime) VALUES (?,?,?,0,1,?)')
    .bind(username, await hashPassword(password), key, now())
    .run();
  const uid = r.meta.last_row_id;
  const syskey = conf.syskey || '';
  const cookie = await makeSessionCookie(c.env, syskey, { role: 'user', id: Number(uid), uid: Number(uid) });
  c.header('Set-Cookie', `epay_session=${cookie}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
  return c.json({ code: 0, data: { uid: Number(uid), key } });
});

user.post('/api/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username || '').first<UserRow>();
  if (!row || !(await verifyPassword(password, row.password))) return c.json({ code: -1, msg: '账号或密码错误' });
  if (row.status !== 1) return c.json({ code: -1, msg: '账号已被禁用' });
  const syskey = (await getConfig(c.env.DB, 'syskey')) || '';
  const cookie = await makeSessionCookie(c.env, syskey, { role: 'user', id: row.uid, uid: row.uid });
  c.header('Set-Cookie', `epay_session=${cookie}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
  return c.json({ code: 0 });
});

user.post('/api/logout', (c) => {
  c.header('Set-Cookie', 'epay_session=; Path=/; HttpOnly; Max-Age=0');
  return c.json({ code: 0 });
});

// ---------- 商户信息 ----------
user.get('/api/me', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  return c.json({
    code: 0,
    data: { uid: u.uid, username: u.username, money: (u.money / 100).toFixed(2), key: u.key, status: u.status },
  });
});

user.get('/api/orders', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const { results } = await c.env.DB.prepare(
    'SELECT trade_no, out_trade_no, type, name, money, status, addtime, endtime FROM orders WHERE uid=? ORDER BY id DESC LIMIT ? OFFSET ?'
  )
    .bind(u.uid, 20, (page - 1) * 20)
    .all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE uid=?').bind(u.uid).first<{ n: number }>();
  return c.json({ code: 0, data: { list: results, total: total?.n || 0 } });
});

user.get('/api/records', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const { results } = await c.env.DB.prepare('SELECT type, money, addtime, note FROM records WHERE uid=? ORDER BY id DESC LIMIT 50').bind(u.uid).all();
  return c.json({ code: 0, data: results });
});

// ---------- 结算申请 (即时到账: 余额实时入账, 提现需审核) ----------
user.post('/api/settle', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const { amount } = await c.req.json<{ amount: string }>();
  const cents = Math.round(Number(amount) * 100);
  if (!cents || cents <= 0) return c.json({ code: -1, msg: '金额错误' });
  const r = await c.env.DB.prepare('UPDATE users SET money=money-? WHERE uid=? AND money>=?').bind(cents, u.uid, cents).run();
  if (!r.meta.changes) return c.json({ code: -1, msg: '余额不足' });
  await c.env.DB.prepare('INSERT INTO settles (uid, amount, addtime, status) VALUES (?,?,?,0)').bind(u.uid, cents, now()).run();
  await c.env.DB.prepare('INSERT INTO records (uid, type, money, addtime, note) VALUES (?,3,?,?,?)')
    .bind(u.uid, cents, now(), '申请结算')
    .run();
  return c.json({ code: 0 });
});
