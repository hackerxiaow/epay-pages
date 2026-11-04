/**
 * EdgeOne Makers Node.js 函数入口。
 *
 * 平台约定：`cloud-functions/**` 下导出 `onRequest(context)` 的文件即一条路由，
 * 静态资源优先于函数。所以：
 *   - `cloud-functions/index.js`        → `/`
 *   - `cloud-functions/[[default]].js`  → 其余所有动态路径
 *
 * 这个文件做四件 Cloudflare 侧不需要的事：
 *   1. 把 `context.request` 物化（Node 运行时把请求体当惰性流，并发下会读串）
 *   2. 把 `context.clientIp / context.geo` 转成请求头，业务代码不用感知平台差异
 *   3. 给 `ExecutionContext` 打垫片（Node 运行时没有 `waitUntil`）
 *   4. 提供 `/api/cron/tick`，给 `edgeone.json` 的 schedules 打
 */
import worker from './index';
import type { Bindings } from './lib/auth';
import { runCron } from './lib/cron';

interface EdgeOneContext {
  request: Request;
  env?: Record<string, string>;
  clientIp?: string;
  geo?: Record<string, unknown>;
  params?: Record<string, string>;
}

const waitUntilPool = new Set<Promise<unknown>>();

/** Node 运行时没有 ExecutionContext，这里给出业务代码用到的那两个方法 */
function executionCtx() {
  return {
    waitUntil(p: Promise<unknown>) {
      const safe = Promise.resolve(p).catch(() => {});
      waitUntilPool.add(safe);
      safe.finally(() => waitUntilPool.delete(safe));
    },
    passThroughOnException() {
      /* 没有等价能力，出错让框架返回 500 */
    },
  };
}

function readEnv(context: EdgeOneContext): Record<string, string> {
  const fromCtx = context.env ?? {};
  const fromProc = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fromProc)) if (typeof v === 'string') out[k] = v;
  for (const [k, v] of Object.entries(fromCtx)) if (typeof v === 'string') out[k] = v;
  return out;
}

function buildBindings(env: Record<string, string>): Bindings {
  return {
    ADMIN_SECRET: env.ADMIN_SECRET || undefined,
    SITE_NAME: env.SITE_NAME || undefined,
  };
}

/**
 * 请求体物化 + 平台信息注入。
 *
 * EdgeOne 的 Node 运行时把请求体当惰性流交给 handler，多个并发请求同时读会竞态
 * （表现为 `Invalid JSON body` / 表单解析失败）。这里一次性读成 ArrayBuffer，
 * 再构造一个新的 Web Request 交给下游。
 */
async function materialize(ctx: EdgeOneContext): Promise<Request> {
  const req = ctx.request;
  const method = (req.method || 'GET').toUpperCase();
  const headers = new Headers(req.headers);

  // 业务层的风控 / 订单 IP 落库只认这两个头，见 lib/net.ts
  if (ctx.clientIp && !headers.get('cf-connecting-ip')) headers.set('cf-connecting-ip', ctx.clientIp);
  const country = String(ctx.geo?.countryCode ?? ctx.geo?.country ?? '').toUpperCase();
  if (country && !headers.get('cf-ipcountry')) headers.set('cf-ipcountry', country);

  if (method === 'GET' || method === 'HEAD') {
    return new Request(req.url, { method, headers });
  }
  try {
    const buf = await req.arrayBuffer();
    return new Request(req.url, { method, headers, body: buf.byteLength ? buf : undefined });
  } catch {
    return new Request(req.url, { method, headers });
  }
}

/** 平台调度入口：token 来自环境变量 CRON_TOKEN，不读数据库（数据库坏了也要能重试通知） */
async function handleCronTick(req: Request, env: Record<string, string>): Promise<Response> {
  const expect = env.CRON_TOKEN || '';
  if (!expect) {
    return Response.json(
      { code: 0, msg: '未配置 CRON_TOKEN，定时任务接口已关闭' },
      { status: 401 }
    );
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') || req.headers.get('x-cron-token') || '';
  if (provided !== expect) return Response.json({ code: 0, msg: 'token 不匹配' }, { status: 403 });

  const data = await runCron(buildBindings(env));
  return Response.json({ code: 0, data });
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  const env = readEnv(context);
  const incoming = context.request;
  const path = new URL(incoming.url).pathname;

  if (path === '/api/cron/tick') {
    return handleCronTick(await materialize(context), env);
  }

  const req = await materialize(context);
  const res = await worker.fetch(req, buildBindings(env), executionCtx() as unknown as ExecutionContext);

  // 函数返回后 Node 进程不会立刻退出，把后台任务挂一下，避免被提前回收
  if (waitUntilPool.size > 0) {
    await Promise.race([
      Promise.allSettled([...waitUntilPool]),
      new Promise((r) => setTimeout(r, 300)),
    ]);
  }
  return res;
}

export default { onRequest };
