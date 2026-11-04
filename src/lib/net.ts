/**
 * 取客户端 IP / 国家码。
 *
 * Cloudflare 版直接读 `cf-connecting-ip` 和 `request.cf.country`；EdgeOne 没有这两样，
 * 平台把信息放在 Node 函数的 `context.clientIp / context.geo` 里，
 * 由 `edgeone-entry.ts` 统一转成 `cf-connecting-ip` / `x-epay-country` 头注入请求。
 *
 * 这样业务代码只认这两个函数，两个分支的行为才是一致的（风控、订单 IP 落库都靠它）。
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const direct = h.get('cf-connecting-ip') || h.get('x-epay-ip');
  if (direct) return direct.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return (h.get('x-real-ip') || '').trim();
}

export function clientCountry(req: Request): string {
  const h = req.headers;
  const raw =
    h.get('cf-ipcountry') ||
    h.get('x-epay-country') ||
    h.get('x-country-code') ||
    (req as Request & { cf?: { country?: string } }).cf?.country ||
    '';
  return String(raw).toUpperCase();
}
