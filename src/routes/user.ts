import { Hono } from 'hono';
import { Bindings, getCookie, hashPassword, makeSessionCookie, parseSessionCookie, verifyPassword } from '../lib/auth';
import { getConfig, getConfigAll, UserRow } from '../lib/db';
import { randomStr, now } from '../lib/util';
import {
  groupGet,
  orderListUser,
  recordAdd,
  recordList,
  regDel,
  regGet,
  regSet,
  settleAdd,
  userAddMoney,
  userByName,
  userByNameOrUid,
  userByUid,
  userInsert,
  userPatch,
} from '../lib/repo';

export const user = new Hono<{ Bindings: Bindings }>();

async function currentUser(env: Bindings, req: Request): Promise<UserRow | null> {
  const syskey = (await getConfig('syskey')) || '';
  const session = await parseSessionCookie(env, syskey, getCookie(req, 'epay_session'));
  if (session?.role !== 'user') return null;
  return await userByUid(session.uid!);
}

const OPEN_USER_PATHS = ['/user/api/register', '/user/api/login', '/user/api/logout', '/user/api/sendcode'];
user.use('/api/*', async (c, next) => {
  if (OPEN_USER_PATHS.includes(c.req.path)) return next();
  const u = await currentUser(c.env, c.req.raw);
  if (!u) return c.json({ code: 403, msg: '未登录' }, 403);
  c.set('userRow' as never, u as never);
  await next();
});

// ---------- 注册 / 登录 ----------
user.post('/api/register', async (c) => {
  const conf = await getConfigAll();
  if (conf.reg_open !== '1') return c.json({ code: -1, msg: '当前未开放注册' });
  const { username, password, email, email_code, captcha_id, captcha_answer, invite } = await c.req.json<{
    username: string; password: string; email?: string; email_code?: string;
    captcha_id?: string; captcha_answer?: string; invite?: string;
  }>();
  if (!username || !password || password.length < 6) return c.json({ code: -1, msg: '参数不完整或密码过短' });
  if (!/^[a-zA-Z0-9_@.]{3,32}$/.test(username)) return c.json({ code: -1, msg: '用户名格式错误' });
  // 图形验证码
  if (conf.captcha_open === '1') {
    if (!captcha_id || !captcha_answer) return c.json({ code: -1, msg: '请输入图形验证码' });
    const cap = await regGet(`cap:${captcha_id}`);
    await regDel(`cap:${captcha_id}`);
    if (!cap || cap.v !== String(captcha_answer)) return c.json({ code: -1, msg: '图形验证码错误' });
  }
  // 邮箱验证码
  let emailFinal = '';
  if (conf.email_verify === '1') {
    if (!email || !email_code) return c.json({ code: -1, msg: '请输入邮箱及验证码' });
    const row = await regGet(`email:${email}`);
    await regDel(`email:${email}`);
    if (!row || row.v !== String(email_code)) return c.json({ code: -1, msg: '邮箱验证码错误' });
    emailFinal = email;
  }
  const dup = await userByName(username);
  if (dup) return c.json({ code: -1, msg: '用户名已存在' });
  // 邀请人
  let inviteUid = 0;
  if (invite) {
    const inv = await userByNameOrUid(invite, parseInt(invite, 10) || 0);
    if (inv) inviteUid = inv.uid;
  }
  const key = randomStr(32);
  let uid: number;
  try {
    uid = await userInsert({ username, password: await hashPassword(password), key, email: emailFinal, invite_uid: inviteUid });
  } catch (e) {
    // 并发注册同名时唯一索引会失败
    if (String(e).includes('USERNAME_EXISTS')) return c.json({ code: -1, msg: '用户名已存在' });
    throw e;
  }
  const syskey = conf.syskey || '';
  const cookie = await makeSessionCookie(c.env, syskey, { role: 'user', id: uid, uid });
  c.header('Set-Cookie', `epay_session=${cookie}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
  return c.json({ code: 0, data: { uid, key } });
});

user.post('/api/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  const row = await userByName(username || '');
  if (!row || !(await verifyPassword(password, row.password))) return c.json({ code: -1, msg: '账号或密码错误' });
  if (row.status !== 1) return c.json({ code: -1, msg: '账号已被禁用' });
  const syskey = (await getConfig('syskey')) || '';
  const cookie = await makeSessionCookie(c.env, syskey, { role: 'user', id: row.uid, uid: row.uid });
  c.header('Set-Cookie', `epay_session=${cookie}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
  return c.json({ code: 0 });
});

user.post('/api/logout', (c) => {
  c.header('Set-Cookie', 'epay_session=; Path=/; HttpOnly; Max-Age=0');
  return c.json({ code: 0 });
});

// 发送邮箱验证码 (webhook 由管理员配置)
user.post('/api/sendcode', async (c) => {
  const conf = await getConfigAll();
  if (conf.email_verify !== '1') return c.json({ code: -1, msg: '未开启邮箱验证' });
  const { email } = await c.req.json<{ email: string }>();
  if (!email || !/^[^@]+@[^@]+$/.test(email)) return c.json({ code: -1, msg: '邮箱格式错误' });
  const code = String(Math.floor(Math.random() * 900000) + 100000);
  // 原 SQL: INSERT ... ON CONFLICT(k) DO UPDATE SET v=excluded.v, time=excluded.time
  await regSet(`email:${email}`, code, now());
  const webhook = conf.email_webhook || '';
  if (webhook) {
    c.executionCtx.waitUntil(
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, subject: '注册验证码' }),
      }).catch(() => {})
    );
  }
  return c.json({ code: 0, msg: '验证码已发送' });
});

// ---------- 商户信息 ----------
user.get('/api/me', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const group = await groupGet(u.gid);
  return c.json({
    code: 0,
    data: {
      uid: u.uid, username: u.username, money: (u.money / 100).toFixed(2), key: u.key, status: u.status,
      keytype: u.keytype || 0, cert: u.cert || 0, gid: u.gid, rate: group?.rate || 0,
      invite_uid: u.invite_uid || 0, domain: u.domain || '', email: u.email || '',
    },
  });
});

user.get('/api/orders', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const { list, total } = await orderListUser(u.uid, page, 20);
  // 与原 SELECT 的字段集保持一致
  const results = list.map((o) => ({
    trade_no: o.trade_no,
    out_trade_no: o.out_trade_no,
    type: o.type,
    name: o.name,
    money: o.money,
    status: o.status,
    addtime: o.addtime,
    endtime: o.endtime,
  }));
  return c.json({ code: 0, data: { list: results, total } });
});

user.get('/api/records', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const rows = await recordList(u.uid, 50);
  const results = rows.map((r) => ({ type: r.type, money: r.money, addtime: r.addtime, note: r.note }));
  return c.json({ code: 0, data: results });
});

// ---------- 实名认证 ----------
user.post('/api/cert', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const { name, idcard } = await c.req.json<{ name: string; idcard: string }>();
  if (!name || !idcard) return c.json({ code: -1, msg: '请填写姓名与证件号' });
  await userPatch(u.uid, { cert: 1, cert_name: name, cert_no: idcard });
  return c.json({ code: 0, msg: '已提交, 等待管理员审核' });
});

// ---------- 结算申请 (即时到账: 余额实时入账, 提现需审核) ----------
user.post('/api/settle', async (c) => {
  const u = c.get('userRow' as never) as unknown as UserRow;
  const { amount } = await c.req.json<{ amount: string }>();
  const cents = Math.round(Number(amount) * 100);
  if (!cents || cents <= 0) return c.json({ code: -1, msg: '金额错误' });
  // 原 SQL: UPDATE users SET money=money-? WHERE uid=? AND money>=?
  const ok = await userAddMoney(u.uid, -cents);
  if (!ok) return c.json({ code: -1, msg: '余额不足' });
  await settleAdd(u.uid, cents);
  await recordAdd(u.uid, 3, cents, '申请结算');
  return c.json({ code: 0 });
});
