import { Hono } from 'hono';
import { Bindings } from './lib/auth';
import { proto } from './routes/proto';
import { channelRoutes } from './routes/channel';
import { admin } from './routes/admin';
import { user } from './routes/user';
import { misc } from './routes/misc';
import { registerPlugin } from './lib/channel';
import { epayPlugin } from './lib/plugins/epay';
import { vmqPlugin } from './lib/plugins/vmq';
import { bepusdtPlugin } from './lib/plugins/bepusdt';
import { xorpayPlugin } from './lib/plugins/xorpay';
import { alipayF2fPlugin } from './lib/plugins/alipayf2f';
import { wxpayNativePlugin } from './lib/plugins/wxpaynative';
import { alipayBillPlugin } from './lib/plugins/alipaybill';
import { qqBillPlugin } from './lib/plugins/qqbill';
import { tronUsdtPlugin } from './lib/plugins/tronusdt';
import { features } from './routes/features';
import { vmqCompat } from './routes/vmqcompat';
import { onebot } from './routes/onebot';

registerPlugin(epayPlugin);
registerPlugin(vmqPlugin);
registerPlugin(bepusdtPlugin);
registerPlugin(xorpayPlugin);
registerPlugin(alipayF2fPlugin);
registerPlugin(wxpayNativePlugin);
registerPlugin(alipayBillPlugin);
registerPlugin(qqBillPlugin);
registerPlugin(tronUsdtPlugin);

const app = new Hono<{ Bindings: Bindings }>();

// 探针：确认线上跑的是仓库里提交的那份函数产物
const BUILD_PROBE = 'probe-b2';

app.route('/', proto);
app.route('/', channelRoutes);
app.route('/admin', admin);
app.route('/user', user);
app.route('/', misc);
app.route('/', features);
app.route('/', vmqCompat);
app.route('/', onebot);

// 存储未就绪时给出可读提示，而不是裸 500
app.use('*', async (c, next) => {
  await next();
  c.header('x-epay-probe', BUILD_PROBE);
});

app.onError((err, c) => {
  const e = err as { code?: string; message?: string; hint?: string };
  if (e.code === 'STORE_CONFIG_MISSING') {
    return c.text(`存储未就绪（EdgeOne Blob）\n\n${e.message}\n\n${e.hint || ''}`, 503);
  }
  console.error('[app] unhandled error:', err);
  return c.text('Internal Server Error', 500);
});

// 兜底 404
//
// Cloudflare 版的静态资源要经过 Worker 转发（`env.ASSETS.fetch`）；
// EdgeOne 是「静态文件优先于函数」，命中静态文件时函数根本不会被调用，
// 所以这里只负责没命中任何路由 + 没有同名静态文件的情况。
// HTML 的 no-cache 由 edgeone.json 的 headers 规则保证，不在这里设置。
app.all('*', (c) => c.text('Not Found', 404));

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
