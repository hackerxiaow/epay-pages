import md5 from 'blueimp-md5';

export { md5 };

/**
 * 易支付协议签名: 参数按 key ASCII 升序拼接 k=v&... ，排除
 * sign / sign_type / 空值，末尾直接拼接商户密钥后取 MD5
 */
export function buildSignString(params: Record<string, string | number | undefined>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function buildSign(params: Record<string, string | number | undefined>, key: string): string {
  return md5(buildSignString(params) + key);
}

export function verifySign(
  params: Record<string, string | number | undefined>,
  key: string,
  sign: string | undefined | null
): boolean {
  if (!sign) return false;
  return buildSign(params, key) === sign;
}
