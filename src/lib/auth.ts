import { md5 } from './sign';
import { now } from './util';

export interface Bindings {
  DB: D1Database;
  ADMIN_SECRET?: string;
  SITE_NAME?: string;
}

/** PBKDF2-SHA256 口令哈希, 格式 pbkdf2$iter$salt$hash */
export async function hashPassword(pwd: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pwd, salt, 100000);
  const s = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const h = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2$100000$${s}$${h}`;
}

export async function verifyPassword(pwd: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  const salt = new Uint8Array(parts[2].match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const expect = parts[3];
  const hash = await pbkdf2(pwd, salt, iter);
  const h = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return h === expect;
}

async function pbkdf2(pwd: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface Session {
  role: 'admin' | 'user';
  id: number; // admin 恒为 0
  uid?: number; // merchant uid
}

/** 会话 Cookie: role.uid.exp.hmac  (原版 authcode(SYS_KEY) 的等价替代, HMAC-SHA256 不可伪造) */
export async function makeSessionCookie(env: Bindings, syskey: string, s: Session, days = 7): Promise<string> {
  const secret = env.ADMIN_SECRET || syskey;
  const exp = now() + days * 86400;
  const payload = `${s.role}.${s.id}.${exp}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function parseSessionCookie(
  env: Bindings,
  syskey: string,
  cookie: string | undefined
): Promise<Session | null> {
  if (!cookie) return null;
  const secret = env.ADMIN_SECRET || syskey;
  const parts = cookie.split('.');
  if (parts.length !== 4) return null;
  const [role, id, exp, sig] = parts;
  if ((await hmac(secret, `${role}.${id}.${exp}`)) !== sig) return null;
  if (parseInt(exp, 10) < now()) return null;
  if (role === 'admin') return { role: 'admin', id: 0 };
  if (role === 'user') {
    const uid = parseInt(id, 10);
    if (!uid) return null;
    return { role: 'user', id: uid, uid };
  }
  return null;
}

export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('Cookie');
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** 登录限速: 同 IP 连续失败计数 (config 表), 超过 10 次/10分钟 拒绝 */
export const LOGIN_LIMIT_KEY = 'login_fail';
