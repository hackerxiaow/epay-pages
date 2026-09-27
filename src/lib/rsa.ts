/**
 * RSA2 签名 (SHA256withRSA, RSASSA-PKCS1-v1_5)
 * 用于: 商户 RSA 接入验签、平台通知签名、支付宝渠道、微信 V3 预留
 */

function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToPem(buf: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buf);
  let b64 = btoa(String.fromCharCode(...bytes));
  b64 = b64.replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
}

async function importKey(pem: string, isPrivate: boolean): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    isPrivate ? 'pkcs8' : 'spki',
    pemToBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    [isPrivate ? 'sign' : 'verify']
  );
}

export async function rsaSign(privatePem: string, content: string): Promise<string> {
  const key = await importKey(privatePem, true);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(content));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function rsaVerify(publicPem: string, content: string, signB64: string): Promise<boolean> {
  try {
    const key = await importKey(publicPem, false);
    const raw = Uint8Array.from(atob(signB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      raw as BufferSource,
      new TextEncoder().encode(content)
    );
  } catch {
    return false;
  }
}

/** 生成平台 RSA 密钥对, 返回 PEM */
export async function rsaGenerate(): Promise<{ publicPem: string; privatePem: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return {
    publicPem: bufferToPem(pub, 'PUBLIC KEY'),
    privatePem: bufferToPem(priv, 'PRIVATE KEY'),
  };
}
