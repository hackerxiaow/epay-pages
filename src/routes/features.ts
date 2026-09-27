import { Hono } from 'hono';
import { Bindings, getCookie, parseSessionCookie } from '../lib/auth';
import { getConfig, getConfigAll, getUserByUid, setConfig } from '../lib/db';
import { randomStr, now, cents2str, str2cents } from '../lib/util';
import { createOrderDirect } from './proto';
import { listPlugins } from '../lib/channel';
import { rsaGenerate } from '../lib/rsa';
import { alipayTransfer } from '../lib/plugins/alipayf2f';

export const features = new Hono<{ Bindings: Bindings }>();

async function requireAdmin(env: Bindings, req: Request): Promise<boolean> {
  const syskey = (await getConfig(env.DB, 'syskey')) || '';
  const session = await parseSessionCookie(env, syskey, getCookie(req, 'epay_session'));
  return session?.role === 'admin';
}

// 公开运营统计 (仅聚合数字, 仿码支付平台首页)
features.get('/api/stats', async (c) => {
  const ts = now() - 86400;
  const [users, ordersToday, moneyToday, ordersAll] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE addtime>=?').bind(ts).first<{ n: number }>(),
    c.env.DB.prepare('SELECT IFNULL(SUM(money),0) s FROM orders WHERE status>=1 AND addtime>=?').bind(ts).first<{ s: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) n FROM orders').first<{ n: number }>(),
  ]);
  return c.json({
    code: 0,
    data: {
      merchants: users?.n || 0,
      orders_today: ordersToday?.n || 0,
      money_today: (moneyToday?.s || 0) / 100,
      orders_all: ordersAll?.n || 0,
    },
  });
});

// 注册配置 (公共, 供前端渲染验证码/邮箱开关)
features.get('/api/regconfig', async (c) => {
  const conf = await getConfigAll(c.env.DB);
  return c.json({ code: 0, data: { captcha_open: conf.captcha_open === '1', email_verify: conf.email_verify === '1', reg_open: conf.reg_open === '1' } });
});

// 平台公告 (公共)
features.get('/api/announcement', async (c) => {
  return c.json({ code: 0, data: (await getConfig(c.env.DB, 'announcement')) || '' });
});

// ==================== 图形验证码 ====================
features.get('/api/captcha', async (c) => {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const id = randomStr(16);
  const answer = String(a + b);
  await c.env.DB.prepare('INSERT INTO regcodes (k, v, time) VALUES (?,?,?)').bind(`cap:${id}`, answer, now()).run();
  await c.env.DB.prepare('DELETE FROM regcodes WHERE time < ?').bind(now() - 600).run();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#f0f4f8"/><text x="18" y="27" font-size="20" font-family="Georgia" fill="#337ab7" transform="rotate(${Math.random() * 10 - 5} 30 20)">${a} + ${b} = ?</text><line x1="0" y1="${Math.random() * 40}" x2="120" y2="${Math.random() * 40}" stroke="#aac" stroke-width="1"/><line x1="0" y1="${Math.random() * 40}" x2="120" y2="${Math.random() * 40}" stroke="#aac" stroke-width="1"/></svg>`;
  return c.json({ code: 0, data: { id, svg } });
});

async function verifyCaptcha(env: Bindings, id: string, answer: string): Promise<boolean> {
  if (!id || !answer) return false;
  const row = await env.DB.prepare('SELECT v FROM regcodes WHERE k=?').bind(`cap:${id}`).first<{ v: string }>();
  await env.DB.prepare('DELETE FROM regcodes WHERE k=?').bind(`cap:${id}`).run();
  return !!row && row.v === answer;
}

// ==================== 码牌收款 (固定商户收款页) ====================
features.get('/pay/:uid', async (c) => {
  const uid = parseInt(c.req.param('uid'), 10);
  const user = await getUserByUid(c.env.DB, uid);
  if (!user || user.status !== 1) return c.html('<meta charset="utf-8"><body style="text-align:center;padding-top:60px;font-family:sans-serif"><h3>商户不存在</h3></body>');
  const conf = await getConfigAll(c.env.DB);
  let types: string[] = [];
  try {
    types = Object.keys(JSON.parse(conf.channel_map || '{}'));
  } catch {}
  const sitename = conf.sitename || 'Epay';
  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${user.username} - 收款</title>
<style>body{font-family:sans-serif;background:#f5f6f7;margin:0}.box{max-width:380px;margin:50px auto;background:#fff;border-radius:10px;padding:34px 28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}.t{text-align:center;color:#337ab7;font-size:20px;font-weight:700;margin-bottom:4px}.m{text-align:center;color:#999;font-size:12px;margin-bottom:24px}input,select{width:100%;padding:12px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;font-size:16px;margin-bottom:14px}.amt{font-size:28px;text-align:center}button{width:100%;padding:13px;border:0;border-radius:6px;background:#337ab7;color:#fff;font-size:16px;font-weight:600}</style></head><body>
<div class="box"><div class="t">${sitename}</div><div class="m">商户：${user.username}（ID ${uid}）</div>
<form method="get" action="/paygo/${uid}">
<input class="amt" name="money" type="number" step="0.01" min="0.01" placeholder="输入金额" required>
<select name="type">${types.map((t) => `<option value="${t}">${t === 'alipay' ? '支付宝' : t === 'wxpay' ? '微信支付' : t === 'usdt' ? 'USDT' : t}</option>`).join('')}</select>
<button type="submit">立即支付</button></form></div></body></html>`);
});

features.get('/paygo/:uid', async (c) => {
  const uid = parseInt(c.req.param('uid'), 10);
  const money = c.req.query('money') || '';
  const type = c.req.query('type') || 'alipay';
  const cents = str2cents(money);
  if (!cents) return c.html('<meta charset="utf-8"><body style="text-align:center;padding-top:60px">金额错误</body>');
  const r = await createOrderDirect(c.env, c.req.raw, {
    uid,
    type,
    money: cents,
    name: `码牌收款`,
    out_trade_no: 'CODE' + Date.now(),
    notify_url: '',
    return_url: '',
    skipRisk: true,
  });
  if (!r.ok) return c.html(`<meta charset="utf-8"><body style="text-align:center;padding-top:60px;color:#e64340">${r.msg}</body>`);
  return c.redirect(`/cashier/${r.tradeNo}`);
});

// ==================== 文档页 ====================
features.get('/doc', (c) => {
  return c.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>接入文档</title>
<style>body{font-family:sans-serif;max-width:860px;margin:30px auto;padding:0 18px;color:#333;line-height:1.8}h2{color:#337ab7;border-bottom:2px solid #eee;padding-bottom:6px}code,pre{background:#f5f7f9;border-radius:4px;padding:2px 6px;font-size:13px}pre{padding:14px;overflow:auto;border:1px solid #eee}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e5e5e5;padding:8px 10px;text-align:left}th{background:#f5f7f9}</style></head><body>
<h1>商户接入文档（彩虹易支付协议兼容）</h1>
<h2>1. 创建支付订单</h2>
<p>请求 <code>GET/POST /submit.php</code>（浏览器跳转）或 <code>/mapi.php</code>（返回 JSON）：</p>
<table><tr><th>参数</th><th>说明</th></tr>
<tr><td>pid</td><td>商户ID</td></tr><tr><td>type</td><td>alipay / wxpay / usdt …（以平台开放为准）</td></tr>
<tr><td>out_trade_no</td><td>商户订单号，唯一</td></tr><tr><td>notify_url</td><td>异步通知地址</td></tr>
<tr><td>return_url</td><td>支付完成跳转地址</td></tr><tr><td>name</td><td>商品名称</td></tr>
<tr><td>money</td><td>金额（元，两位小数）</td></tr><tr><td>sign</td><td>签名（见下）</td></tr>
<tr><td>sign_type</td><td>MD5 或 RSA</td></tr></table>
<h2>2. 签名规则</h2>
<p>参数按 <b>key ASCII 升序</b> 排列，排除 <code>sign / sign_type / 空值</code>，以 <code>k=v&</code> 拼接后：</p>
<pre>MD5：md5(拼接串 + 商户密钥)
RSA：SHA256withRSA(拼接串)，商户在后台绑定公钥</pre>
<h2>3. 异步通知</h2>
<p>平台 GET 请求 <code>notify_url</code>，携带 <code>pid, trade_no, out_trade_no, type, name, money, trade_status=TRADE_SUCCESS, sign</code>，验签通过请输出 <code>success</code>（原样小写），否则平台最多重试 5 次。</p>
<h2>4. 订单查询 / 退款</h2>
<pre>查询：GET /api.php?act=order&pid=&key=商户密钥&trade_no=
退款：POST /api.php?act=refundapi  (trade_no, money, key=md5(trade_no+系统密钥+trade_no))</pre>
<h2>5. mapi.php 返回</h2>
<pre>{"code":1, "trade_no":"...", "payurl":"跳转链接", "qrcode":"二维码内容"}</pre>
<p style="color:#999">更多能力（码牌收款 /pay/&lt;uid&gt;、余额结算、RSA 接入）请在商户中心查看。</p>
</body></html>`);
});

// ==================== 管理端扩展 ====================
features.use('/admin/api/*', async (c, next) => {
  if (!(await requireAdmin(c.env, c.req.raw))) return c.json({ code: 403, msg: '未登录' }, 403);
  await next();
});

// 订单导出 CSV (Excel 友好, 带 BOM)
features.get('/admin/api/export', async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10);
  const since = now() - days * 86400;
  const { results } = await c.env.DB.prepare(
    'SELECT trade_no, out_trade_no, uid, type, name, money, realmoney, status, addtime, endtime FROM orders WHERE addtime>=? ORDER BY id DESC LIMIT 5000'
  )
    .bind(since)
    .all();
  const head = '平台订单号,商户订单号,商户ID,支付方式,商品名称,订单金额(元),实付(元),状态,下单时间,支付时间';
  const st = ['待支付', '已支付', '已退款', '已完成'];
  const lines = (results || []).map((o: Record<string, unknown>) =>
    [o.trade_no, o.out_trade_no, o.uid, o.type, `"${String(o.name || '').replace(/"/g, '""')}"`, cents2str(Number(o.money)), cents2str(Number(o.realmoney)), st[Number(o.status)] || o.status,
     o.addtime ? new Date(Number(o.addtime) * 1000).toLocaleString('zh-CN') : '', o.endtime ? new Date(Number(o.endtime) * 1000).toLocaleString('zh-CN') : ''].join(',')
  );
  const csv = '\uFEFF' + [head, ...lines].join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders_${days}d.csv"`,
    },
  });
});

// 支付用户统计
features.get('/admin/api/buyerstat', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT ip, COUNT(*) n, SUM(money) total, MAX(addtime) last FROM orders WHERE status>=1 AND ip!="" GROUP BY ip ORDER BY n DESC LIMIT 100'
  ).all();
  return c.json({ code: 0, data: results });
});

// 7日趋势
features.get('/admin/api/trend', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT date(addtime, 'unixepoch', '+8 hours') d, COUNT(*) n, SUM(CASE WHEN status>=1 THEN money ELSE 0 END) s
     FROM orders WHERE addtime>=? GROUP BY d ORDER BY d`
  )
    .bind(now() - 7 * 86400)
    .all();
  return c.json({ code: 0, data: results });
});

// 商户分组 (费率)
features.get('/admin/api/groups', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM groups ORDER BY id').all();
  return c.json({ code: 0, data: results });
});
features.post('/admin/api/groups', async (c) => {
  const b = await c.req.json<{ id?: number; name: string; rate: number }>();
  if (b.id) {
    await c.env.DB.prepare('UPDATE groups SET name=?, rate=? WHERE id=?').bind(b.name, b.rate, b.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO groups (name, rate) VALUES (?,?)').bind(b.name, b.rate).run();
  }
  return c.json({ code: 0 });
});
features.post('/admin/api/groups/delete', async (c) => {
  const { id } = await c.req.json<{ id: number }>();
  if (id === 1) return c.json({ code: -1, msg: '默认分组不可删除' });
  await c.env.DB.prepare('UPDATE users SET gid=1 WHERE gid=?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM groups WHERE id=?').bind(id).run();
  return c.json({ code: 0 });
});

// 平台 RSA 密钥对生成
features.post('/admin/api/rsa/generate', async (c) => {
  const { publicPem, privatePem } = await rsaGenerate();
  await setConfig(c.env.DB, 'rsa_public', publicPem);
  await setConfig(c.env.DB, 'rsa_private', privatePem);
  return c.json({ code: 0, data: { publicPem } });
});
features.get('/admin/api/rsa', async (c) => {
  return c.json({ code: 0, data: { publicPem: (await getConfig(c.env.DB, 'rsa_public')) || '' } });
});

// 实名审核
features.get('/admin/api/certs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT uid, username, cert, cert_name, cert_no FROM users WHERE cert=1 ORDER BY uid').all();
  return c.json({ code: 0, data: results });
});
features.post('/admin/api/certs/review', async (c) => {
  const { uid, status } = await c.req.json<{ uid: number; status: number }>();
  await c.env.DB.prepare('UPDATE users SET cert=? WHERE uid=?').bind(status, uid).run();
  return c.json({ code: 0 });
});

// 结算自动打款 (支付宝转账, 需渠道启用 enable_transfer)
features.post('/admin/api/settles/pay', async (c) => {
  const { id, account, name } = await c.req.json<{ id: number; account: string; name?: string }>();
  const row = await c.env.DB.prepare('SELECT s.*, u.username FROM settles s LEFT JOIN users u ON u.uid=s.uid WHERE s.id=?').bind(id).first<{ id: number; uid: number; amount: number; status: number; username: string }>();
  if (!row) return c.json({ code: -1, msg: '记录不存在' });
  if (row.status !== 0) return c.json({ code: -1, msg: '已处理' });
  const chRow = await c.env.DB.prepare("SELECT config FROM channels WHERE plugin='alipayf2f' AND status=1").all<{ config: string }>();
  let cfgRaw = '';
  for (const ch of chRow.results || []) {
    try {
      const cfg = JSON.parse(ch.config || '{}');
      if (cfg.enable_transfer === '1') {
        cfgRaw = JSON.stringify(cfg);
        break;
      }
    } catch {}
  }
  if (!cfgRaw) return c.json({ code: -1, msg: '没有启用自动打款的支付宝渠道' });
  const r = await alipayTransfer(cfgRaw, 'ST' + row.id + '_' + now(), cents2str(row.amount), account, name || row.username, '结算打款');
  if (!r.ok) return c.json({ code: -1, msg: '打款失败: ' + r.msg });
  await c.env.DB.prepare('UPDATE settles SET status=1, note=? WHERE id=?').bind(`支付宝转账单号 ${r.orderNo || ''}`, id).run();
  return c.json({ code: 0, msg: '打款成功' });
});

// 插件清单 (供 admin.html 渲染, 含多行字段)
features.get('/admin/api/plugins', (c) => {
  return c.json({
    code: 0,
    data: listPlugins().map((p) => ({ id: p.id, name: p.name, types: p.types, inputs: p.inputs })),
  });
});
