export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** 生成平台订单号: 14位时间 + 6位随机, 共20位 */
export function genTradeNo(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const t = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return t + String(Math.floor(Math.random() * 900000) + 100000);
}

/** 分 -> 元字符串 (0.01 起) */
export function cents2str(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元字符串 -> 分 */
export function str2cents(s: string): number {
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function randomHex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomStr(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 商户后台等脱敏 */
export function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '********' + k.slice(-4);
}
