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

app.route('/', proto);
app.route('/', channelRoutes);
app.route('/admin', admin);
app.route('/user', user);
app.route('/', misc);
app.route('/', features);
app.route('/', vmqCompat);
app.route('/', onebot);

// 静态资源回退 (Pages Assets / Worker Assets)
app.all('*', async (c) => {
  const assets = (c.env as { ASSETS?: Fetcher }).ASSETS;
  if (assets) {
    try {
      const res = await assets.fetch(c.req.raw);
      // HTML 文件禁用缓存, 避免用户浏览器和 CDN 缓存旧前端代码
      const path = c.req.path;
      if (path.endsWith('.html') || path === '/admin' || path === '/user') {
        const h = new Headers(res.headers);
        h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        h.set('Pragma', 'no-cache');
        h.set('Expires', '0');
        return new Response(res.body, { status: res.status, headers: h });
      }
      return res;
    } catch {}
  }
  return c.text('Not Found', 404);
});

export default {
  async fetch(request: Request, env: Bindings & { ASSETS?: Fetcher }, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
