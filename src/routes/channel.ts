import { Hono } from 'hono';
import { Bindings } from '../lib/auth';
import { OrderRow } from '../lib/db';
import { markOrderPaid, sendMerchantNotifySafe } from '../lib/orderflow';
import { getPlugin, NotifyCtx } from '../lib/channel';
import { vmqPush, vmqTask } from '../lib/plugins/vmq';

export const channelRoutes = new Hono<{ Bindings: Bindings }>();

/** 上游渠道回调入口: /channel/notify/:plugin/:channelId */
channelRoutes.all('/channel/notify/:plugin/:channelId', async (c) => {
  const pluginId = c.req.param('plugin');
  const channelId = parseInt(c.req.param('channelId'), 10);
  const chRow = await c.env.DB.prepare('SELECT * FROM channels WHERE id=? AND status=1')
    .bind(channelId)
    .first<{ id: number; plugin: string; name: string; status: number; config: string; types: string }>();
  if (!chRow || chRow.plugin !== pluginId) return c.text('fail');
  const plugin = getPlugin(pluginId);
  if (!plugin?.onNotify) return c.text('fail');

  let config: Record<string, string> = {};
  try {
    config = JSON.parse(chRow.config || '{}');
  } catch {}

  const ctx: NotifyCtx = {
    env: c.env,
    channel: { id: chRow.id, plugin: chRow.plugin, config },
    req: c.req.raw,
    url: new URL(c.req.url),
  };
  const r = await plugin.onNotify(ctx);
  if (!r.ok || !r.tradeNo) return c.text(r.respond || 'fail');

  const paid = await markOrderPaid(c.env, r.tradeNo, r.money || 0, r.apiTradeNo || '');
  if (paid) {
    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE trade_no=?')
      .bind(r.tradeNo)
      .first<OrderRow>();
    if (order) c.executionCtx.waitUntil(sendMerchantNotifySafe(c.env, order));
  }
  return c.text(r.respond);
});

/** V免签挂机端: 轮询取单 */
channelRoutes.all('/app/vmq/task', async (c) => {
  const key = c.req.query('key') || '';
  const type = c.req.query('type') || 'alipay';
  return vmqTask(c.env, key, type);
});

/** V免签挂机端: 推送到账 */
channelRoutes.all('/app/vmq/push', async (c) => {
  const form: Record<string, string> = {};
  new URL(c.req.url).searchParams.forEach((v, k) => (form[k] = v));
  if (c.req.method === 'POST') {
    try {
      const body = await c.req.parseBody();
      for (const k of Object.keys(body)) form[k] = String(body[k]);
    } catch {}
  }
  const r = await vmqPush(c.env, form.key || '', form.trade_no || '', form.price || '');
  return c.text(r.respond);
});
