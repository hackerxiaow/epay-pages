/**
 * 本地预览 / e2e 用的极简服务器。
 *
 * 复刻 EdgeOne 的两条关键行为，用来在本地验证移植是否等价：
 *   1. **静态资源优先**：dist/ 里存在的文件直接返回，不进函数
 *   2. 其余请求交给 cloud-functions/[[default]].js 的 onRequest
 *
 * 数据默认走内存实现（EPAY_STORE=memory），重启即清空 —— 联调和 e2e 足够。
 *
 *   node scripts/eo-local.mjs            # 默认 :8787
 *   PORT=9000 node scripts/eo-local.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const bundle = join(root, '.eo-build', '[[default]].js');
const port = Number(process.env.PORT ?? 8787);

if (!existsSync(bundle)) {
  console.error('缺少 .eo-build/[[default]].js，先跑 npm run eo:build');
  process.exit(1);
}

process.env.EPAY_STORE ??= 'memory';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const worker = await import(pathToFileURL(bundle).href);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);

  // 1) 静态资源优先（与 EdgeOne 一致）
  const file = join(dist, decodeURIComponent(url.pathname));
  if (url.pathname !== '/' && existsSync(file) && statSync(file).isFile()) {
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const cache = file.endsWith('.html') ? 'no-cache' : 'public, max-age=600';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    res.end(readFileSync(file));
    return;
  }

  // 2) 交给函数
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });

  try {
    const response = await worker.onRequest({
      request,
      env: process.env,
      clientIp: req.socket.remoteAddress?.replace('::ffff:', '') ?? '',
    });
    const headers = {};
    response.headers.forEach((v, k) => {
      if (k === 'set-cookie') return;
      headers[k] = v;
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    res.writeHead(response.status, { ...headers, ...(cookies.length ? { 'set-cookie': cookies } : {}) });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error('[local] handler failed', e);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${String(e?.stack ?? e)}`);
  }
});

server.listen(port, () => {
  console.log(`epay-pages (edgeone 本地) → http://localhost:${port}`);
  console.log('数据：内存实现（重启清空）。首次访问 POST /install 完成初始化。');
});
