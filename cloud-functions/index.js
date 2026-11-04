// EdgeOne 平台在部署时会对这个文件做一次 esbuild 打包（platform=node），
// 所以这里只需要把入口指到 TypeScript 源码，不要提交打包产物。
// 本地 e2e 用的完整产物在 .eo-build/[[default]].js（由 npm run eo:build 生成）。
import { onRequest } from '../src/edgeone-entry.ts';

export { onRequest };
export default { onRequest };
