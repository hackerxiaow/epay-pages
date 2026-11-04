/**
 * EdgeOne Blob 存储原语。
 *
 * 这个分支没有 D1 —— EdgeOne Pages 只提供对象存储（Blob），所以「表」被建模成
 * key 前缀，具体键空间见 `repo.ts`。
 *
 * 这里只封装四件事：读 / 写 / 删 / 列 key，外加两个关键语义：
 *
 *   1. `put(..., { onlyIfNew: true })` —— 条件写，等价于主键冲突检测。
 *      金额尾数唯一性、支付幂等标记、自增 id 都靠它做原子判定，不依赖应用层锁。
 *   2. `strong` 一致性 —— 写入后立刻读得到。默认的 eventual 走 CDN 缓存，
 *      支付回调标记完状态、买家马上轮询查单会读到旧值，这套系统必须用强一致。
 *
 * 本地开发 / 单测走内存实现（`EPAY_STORE=memory`），语义与 Blob 对齐。
 */
import { getStore, type Store } from '@edgeone/pages-blob';

export interface BlobStore {
  readonly kind: 'edgeone' | 'memory';
  getText(key: string): Promise<string | null>;
  getJson<T>(key: string): Promise<T | null>;
  /** 返回 false 表示 `onlyIfNew` 冲突（key 已存在） */
  put(key: string, value: string, opts?: { onlyIfNew?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  /** 按 key 前缀列出全部 key（字典序） */
  keys(prefix: string): Promise<string[]>;
}

/* ------------------------------ EdgeOne Blob ------------------------------ */

const STORE_NAME = 'epay';

/** 平台凭据缺失时的专用错误，入口会把它翻译成可读提示而不是裸 500 */
export class StoreConfigError extends Error {
  code = 'STORE_CONFIG_MISSING';
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = 'StoreConfigError';
    this.hint = hint;
  }
}

function isMissingEnv(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === 'MISSING_ENVIRONMENT' || /missing:.*deploycredential/i.test(String(err?.message || ''));
}

/**
 * 显式凭据（兜底路径）。
 *
 * 正常部署时，平台会把函数包里的 `{{PAGES_BLOB_DEPLOY_CREDENTIAL}}` 占位符替换成
 * 项目级凭据；如果这一步没发生（自建构建产物、非 Pages 运行时、项目未开启 Blob），
 * SDK 会报 `Missing: deployCredential`，此时可以用这两个环境变量显式指定：
 *
 *   EPAY_BLOB_PROJECT_ID = makers-xxxxxxxx   （项目 ID，PAGES_PROJECT_ID 也可）
 *   EPAY_BLOB_TOKEN      = <EdgeOne API Token>
 */
function explicitCreds(): { projectId: string; token: string } | null {
  const projectId = process.env.EPAY_BLOB_PROJECT_ID || process.env.PAGES_PROJECT_ID || '';
  const token = process.env.EPAY_BLOB_TOKEN || '';
  return projectId && token ? { projectId, token } : null;
}

const MISSING_HINT =
  'EdgeOne Blob 未就绪。排查顺序：① 控制台确认该项目已启用 Blob/存储；' +
  '② 函数是否被识别为 Node 云函数（cloud-functions/ 目录、构建产物里有 [[default]].js）；' +
  '③ 实在不行，在项目环境变量里配 EPAY_BLOB_PROJECT_ID（makers-xxxx）与 EPAY_BLOB_TOKEN（API Token）走显式凭据。';

function explain(e: unknown): StoreConfigError {
  const msg = String((e as { message?: string })?.message || e);
  return new StoreConfigError(msg, MISSING_HINT);
}

function isPreconditionError(e: unknown): boolean {
  const err = e as { name?: string; code?: string; status?: number; message?: string };
  const text = `${err?.name ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
  return (
    err?.status === 412 ||
    err?.code === 'PRECONDITION_FAILED' ||
    text.includes('precondition') ||
    text.includes('already exists') ||
    text.includes('if-none-match')
  );
}

function createEdgeoneStore(): BlobStore {
  // 注意：用字符串形式创建 Store 时默认是 eventual，
  // 因此每次读都显式带 consistency: 'strong'，不要指望 Store 级别的默认值。
  // 平台凭据是「首次使用时」才校验的，所以这里延迟解析：
  // 先按平台注入的凭据试一次探针读，失败再回落到显式凭据。
  let ready: Store | null = null;
  let resolving: Promise<Store> | null = null;

  const resolve = (): Promise<Store> => {
    if (ready) return Promise.resolve(ready);
    if (resolving) return resolving;
    resolving = (async () => {
      const primary = getStore(STORE_NAME);
      try {
        await primary.get('__probe__', { consistency: 'strong' });
        ready = primary;
        return primary;
      } catch (e) {
        // 网络 / 权限类错误原样抛出，只有「凭据缺失」才走兜底
        if (!isMissingEnv(e)) throw e;
        const creds = explicitCreds();
        if (!creds) throw explain(e);
        const fb = getStore({ name: STORE_NAME, ...creds });
        try {
          await fb.get('__probe__', { consistency: 'strong' });
        } catch (e2) {
          throw explain(e2);
        }
        ready = fb;
        return fb;
      }
    })();
    return resolving;
  };

  return {
    kind: 'edgeone',
    async getText(key) {
      return (await (await resolve()).get(key, { consistency: 'strong' })) ?? null;
    },
    async getJson<T>(key: string) {
      try {
        return (await (await resolve()).get(key, { type: 'json', consistency: 'strong' })) as T | null;
      } catch (e) {
        // 凭据缺失要往上抛，别当成「没有这条数据」把整站静默变成空库
        if (isMissingEnv(e)) throw explain(e);
        // 历史脏数据 / 手工写坏的值按「不存在」处理，避免整站 500
        return null;
      }
    },
    async put(key, value, opts) {
      const store = await resolve();
      try {
        await store.set(key, value, opts?.onlyIfNew ? { onlyIfNew: true } : undefined);
        return true;
      } catch (e) {
        if (opts?.onlyIfNew && isPreconditionError(e)) return false;
        throw e;
      }
    },
    async del(key) {
      await (await resolve()).delete(key);
    },
    async keys(prefix) {
      const r = await (await resolve()).list({ prefix, consistency: 'strong' });
      return r.blobs.map((b) => b.key);
    },
  };
}

/* --------------------------- 内存实现（本地开发） --------------------------- */

function createMemoryStore(): BlobStore {
  const map = new Map<string, string>();
  return {
    kind: 'memory',
    async getText(key) {
      return map.get(key) ?? null;
    },
    async getJson<T>(key: string) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async put(key, value, opts) {
      if (opts?.onlyIfNew && map.has(key)) return false;
      map.set(key, value);
      return true;
    },
    async del(key) {
      map.delete(key);
    },
    async keys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/* --------------------------------- 选择实现 -------------------------------- */

let cached: BlobStore | null = null;

/**
 * 拿一个 Store 实例（进程内复用）。
 *
 * - `EPAY_STORE=edgeone`（默认）：只用 EdgeOne Blob，拿不到直接抛错
 *   —— 生产环境静默降级成内存 = 每次请求都看不到上一笔数据，比报错糟得多
 * - `EPAY_STORE=memory`：强制内存实现（本地 dev / e2e，`eo-local.mjs` 会自动设置）
 * - `EPAY_STORE=auto`：先试 Blob，拿不到降级内存并打日志（只在排查时用）
 */
export function openStore(): BlobStore {
  if (cached) return cached;

  const mode = (process.env.EPAY_STORE ?? 'edgeone').toLowerCase();  if (mode === 'memory') {
    cached = createMemoryStore();
    return cached;
  }

  try {
    cached = createEdgeoneStore();
    return cached;
  } catch (e) {
    if (mode !== 'auto') throw e;
    console.warn('[blob] EdgeOne Blob 不可用，降级为内存存储（重启即丢）：', String(e).slice(0, 160));
    cached = createMemoryStore();
    return cached;
  }
}

/** 测试用：清掉进程内缓存（内存实现的数据也会一起丢） */
export function resetStore(): void {
  cached = null;
}
