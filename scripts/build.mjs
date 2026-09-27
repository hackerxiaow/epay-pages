import esbuild from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  format: 'esm',
  platform: 'neutral',
  mainFields: ['browser', 'module', 'main'],
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

cpSync('public', 'dist', { recursive: true });

// Pages 路由: 静态资源直出, 其余全量进 Worker (无静态劫持 API 风险)
writeFileSync(
  'dist/_routes.json',
  JSON.stringify({ version: 1, include: ['/*'], exclude: ['/assets/*', '/paypage/*'] }, null, 2)
);

console.log('build ok -> dist/_worker.js');
