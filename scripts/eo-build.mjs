/**
 * EdgeOne 构建脚本。
 *
 * 干三件事：
 *   1. 把 `public/` 整目录复制到 `dist/`（EdgeOne 的静态站根目录）
 *      —— 平台的静态资源优先于函数，admin.html / user.html / assets 全部直出，不占函数
 *   2. 用 esbuild 把 `src/edgeone-entry.ts` 打成 `cloud-functions/[[default]].js`
 *      （依赖全部内联，部署包不需要 node_modules）
 *   3. 生成 `cloud-functions/index.js` —— `[[default]]` 只匹配一段以上路径，根路径 `/` 要单独一个入口
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

const outdir = p('cloud-functions');
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
console.log(`\n✓ 函数包 cloud-functions/[[default]].js  ${(fnBytes / 1024).toFixed(0)} KB`);
console.log(`✓ 静态资源 dist/  ${(dirSize(dist) / 1024 / 1024).toFixed(2)} MB`);
console.log('✓ 下一步: npx edgeone makers generate-routes（生成路由表，漏了会全站 404）');
