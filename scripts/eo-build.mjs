/**
 * EdgeOne 构建脚本。
 *
 * 干三件事：
 *   1. 把 `public/` 整目录复制到 `dist/`（EdgeOne 的静态站根目录）
 *      —— 平台的静态资源优先于函数，admin.html / user.html / assets 全部直出，不占函数
 *   2. 用 esbuild 把 `src/edgeone-entry.ts` 打成本地可跑的 `.eo-build/[[default]].js`
 *      （依赖全部内联）
 *
 * 注意：线上部署**不用**这个产物。EdgeOne 在部署时会对仓库里的
 * `cloud-functions/index.js`、`cloud-functions/[[default]].js` 这两个薄壳做一次
 * esbuild 打包（平台在构建命令之前就读取函数目录，所以薄壳必须提交、且不能是过期产物）。
 *
 * 产物：
 *   dist/                           静态站
 *   cloud-functions/[[default]].js  兜底路由
 *   cloud-functions/index.js        `/`
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...xs) => join(root, ...xs);

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/* --------------------------- 1) 静态资源 --------------------------- */

const publicDir = p('public');
if (!existsSync(publicDir)) fail('缺少 public/ 目录');

const dist = p('dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(publicDir, dist, { recursive: true });

/* --------------------------- 2) 打包函数 --------------------------- */

const esbuild = await import('esbuild').catch(() =>
  import(new URL('../node_modules/esbuild/lib/main.js', import.meta.url).href)
);

// 函数产物只用于本地 e2e / 自测：线上由平台从 cloud-functions/*.js 薄壳自行打包，
// 所以这里写到 .eo-build（已 gitignore），不要去覆盖 cloud-functions/ 里的薄壳。
const outdir = p('.eo-build');
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [p('src/edgeone-entry.ts')],
  outfile: join(outdir, '[[default]].js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // 依赖全部打进来：部署包里不需要 node_modules
  external: [],
  legalComments: 'none',
  minify: true,
  logLevel: 'warning',
});

writeFileSync(join(outdir, 'index.js'), "export { onRequest, default } from './[[default]].js';\n", 'utf8');

/* ---------------------------- 3) 汇总 ---------------------------- */

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    total += e.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

const fnBytes = statSync(join(outdir, '[[default]].js')).size;
console.log(`\n✓ 本地函数包 .eo-build/[[default]].js  ${(fnBytes / 1024).toFixed(0)} KB`);
console.log(`✓ 静态资源 dist/  ${(dirSize(dist) / 1024 / 1024).toFixed(2)} MB`);
console.log('✓ cloud-functions/ 保持薄壳不变（线上由平台打包）');
