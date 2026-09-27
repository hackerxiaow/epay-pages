/**
 * Epay Pages 全流程 e2e 测试
 * 本地启动 wrangler dev (127.0.0.1:8787) + mock 上游易支付(9910) + mock 商户端(9911)
 * 覆盖: 安装/登录鉴权/商户/渠道/下单签名/上游回调/商户通知/幂等/VMQ挂机/查询/退款/结算/回跳验签
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8787';
const UPSTREAM_PORT = 9910;
const MERCHANT_PORT = 9911;
const UPSTREAM_KEY = 'upstreamkey1234567890abcdef00';
const MERCHANT_PASS = 'testshop123456';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` | ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}
function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }
function signParams(params, key) {
  const ks = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort();
  return md5(ks.map((k) => `${k}=${params[k]}`).join('&') + key);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- mock 上游易支付 ----------------
const upstreamHits = []; // 收到的 mapi 下单
async function mockUpstreamHandler(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/mapi.php' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      const sign = p.sign; delete p.sign; delete p.sign_type;
      const expect = signParams(p, UPSTREAM_KEY);
      upstreamHits.push({ ...p, signValid: expect === sign });
      // 回调我们的 notify
      const notifyParams = {
        pid: p.pid, trade_no: 'UP' + Date.now(), out_trade_no: p.out_trade_no,
        type: p.type, name: p.name, money: p.money, trade_status: 'TRADE_SUCCESS',
      };
      notifyParams.sign = signParams(notifyParams, UPSTREAM_KEY);
      notifyParams.sign_type = 'MD5';
      const qs = new URLSearchParams(notifyParams).toString();
      http.get(`${p.notify_url}?${qs}`, (r) => r.resume()).on('error', () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 1, payurl: 'https://mock.up/pay/' + p.out_trade_no, qrcode: 'mockup:qrcode:' + p.out_trade_no }));
    });
    return;
  }
  res.writeHead(404); res.end();
}

// ---------------- mock 商户端 ----------------
const merchantNotifies = []; // {url, params, signValid}
const merchantReturns = [];
async function mockMerchantHandler(req, res) {
  const u = new URL(req.url, 'http://x');
  const params = Object.fromEntries(u.searchParams);
  const item = { url: u.pathname, params };
  if (u.pathname === '/notify') {
    const sign = params.sign;
    const expect = signParams(params, globalThis.__merchantKey || '');
    item.signValid = expect === sign;
    merchantNotifies.push(item);
    res.writeHead(200); res.end(globalThis.__merchantNotifyBody || 'success');
    return;
  }
  if (u.pathname === '/return') {
    const sign = params.sign;
    const expect = signParams(params, globalThis.__merchantKey || '');
    item.signValid = expect === sign;
    merchantReturns.push(item);
    res.writeHead(200); res.end('ok');
    return;
  }
  res.writeHead(404); res.end();
}

async function waitFor(fn, timeout = 8000, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}

async function main() {
  // ---------- 启动 mock ----------
  const upServer = http.createServer((q, s) => mockUpstreamHandler(q, s));
  const mcServer = http.createServer((q, s) => mockMerchantHandler(q, s));
  await new Promise((r) => upServer.listen(UPSTREAM_PORT, r));
  await new Promise((r) => mcServer.listen(MERCHANT_PORT, r));

  // ---------- 重置本地 D1 并应用 schema ----------
  execSync('node scripts/build.mjs', { cwd: process.cwd(), stdio: 'pipe' });
  execSync('rm -rf .wrangler/state/v3/d1', { cwd: process.cwd() });
  execSync('npx wrangler d1 execute epay-db --local --file=schema.sql', { cwd: process.cwd(), stdio: 'pipe' });

  // ---------- 启动 wrangler dev ----------
  console.log('启动 wrangler dev ...');
  const wr = spawn('npx', ['wrangler', 'pages', 'dev', '--port', '8787', '--ip', '127.0.0.1'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let wrLog = '';
  wr.stdout.on('data', (d) => (wrLog += d));
  wr.stderr.on('data', (d) => (wrLog += d));
  const up = await waitFor(async () => {
    try { const r = await fetch(BASE + '/'); return r.status === 200; } catch { return false; }
  }, 60000);
  if (!up) { console.error('wrangler dev 启动失败:\n' + wrLog.slice(-3000)); wr.kill(); process.exit(1); }

  try {
    let adminCookie = '';
    let merchantCookie = '';
    const jar = {};

    console.log('\n== 1. 安装与鉴权 ==');
    let r = await fetch(BASE + '/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345678' }) });
    let j = await r.json();
    ok(j.code === 0, '初始化系统成功');
    r = await fetch(BASE + '/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'x12345678' }) });
    j = await r.json();
    ok(j.code === -1, '二次安装被拒绝');
    r = await fetch(BASE + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
    j = await r.json();
    ok(j.code === -1, '错误密码被拒绝');
    r = await fetch(BASE + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345678' }) });
    j = await r.json();
    ok(j.code === 0, '管理员登录成功');
    adminCookie = (r.headers.get('set-cookie') || '').split(';')[0];
    r = await fetch(BASE + '/admin/api/orders', { headers: { Cookie: adminCookie } });
    j = await r.json();
    ok(j.code === 0, '管理员会话有效');
    r = await fetch(BASE + '/admin/api/orders');
    ok(r.status === 403, '未登录访问管理 API 被拒 (403)');

    console.log('\n== 2. 商户与渠道配置 ==');
    r = await fetch(BASE + '/admin/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ username: 'testshop', password: MERCHANT_PASS }) });
    ok((await r.json()).code === 0, '创建商户成功');
    r = await fetch(BASE + '/admin/api/users', { headers: { Cookie: adminCookie } });
    j = await r.json();
    const shop = j.data.list[0];
    ok(shop.username === 'testshop' && shop.key && shop.key.length === 32, '商户密钥已生成 (32位)');
    globalThis.__merchantKey = shop.key;

    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'epay', name: '测试上游', config: { url: `http://127.0.0.1:${UPSTREAM_PORT}`, pid: '1000', key: UPSTREAM_KEY } }) });
    ok((await r.json()).code === 0, '创建易支付上游渠道');
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'vmq', name: '免签挂机', config: { key: 'vmqkey123', qrcode_alipay: 'https://img.example/alipay.png', qrcode_wxpay: 'https://img.example/wx.png' } }) });
    ok((await r.json()).code === 0, '创建VMQ挂机渠道');
    r = await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: 1, wxpay: 2 }), reg_open: '1' }) });
    ok((await r.json()).code === 0, '配置支付方式映射');
    r = await fetch(BASE + '/admin/api/config', { headers: { Cookie: adminCookie } });
    j = await r.json();
    ok(!j.data.admin_pwd, '管理接口不回传密码哈希');
    const syskey = j.data.syskey;
    ok(!!syskey, '系统密钥存在 (存于D1, 不进HTTP响应头)');

    console.log('\n== 3. 易支付协议下单 (submit/mapi) ==');
    const orderArgs = {
      pid: String(shop.uid), type: 'alipay', out_trade_no: 'SHOP' + Date.now(),
      notify_url: `http://127.0.0.1:${MERCHANT_PORT}/notify`,
      return_url: `http://127.0.0.1:${MERCHANT_PORT}/return`,
      name: '测试商品', money: '12.34',
    };
    // 错误签名
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...orderArgs, sign: 'badbadbad', sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === -1 && j.msg.includes('签名'), '错误签名被拒绝');
    // 正确签名 submit → 302 收银台
    const submitUrl = BASE + '/submit.php?' + new URLSearchParams({ ...orderArgs, sign: signParams(orderArgs, shop.key), sign_type: 'MD5' });
    r = await fetch(submitUrl, { redirect: 'manual' });
    ok(r.status === 302 && (r.headers.get('location') || '').startsWith('/cashier/'), 'submit.php 正确签名 → 跳转收银台');
    // 正确签名 mapi → JSON
    const outM = 'SHOPM' + Date.now();
    const mapiArgs = { ...orderArgs, out_trade_no: outM };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...mapiArgs, sign: signParams(mapiArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.payurl.includes('mock.up') && j.qrcode.startsWith('mockup:'), 'mapi.php 返回上游支付链接与二维码');
    const tradeNoM = j.trade_no;
    ok(upstreamHits.length >= 1 && upstreamHits[0].signValid === true, '我方对上游的 mapi 下单签名正确 (协议兼容)');
    // 支付方式未配置
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...orderArgs, type: 'qqpay', out_trade_no: 'SHOQ' + Date.now(), sign: signParams({ ...orderArgs, type: 'qqpay', out_trade_no: 'SHOQ' + Date.now() }, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === -1, '未配置的支付方式被拒绝');

    console.log('\n== 4. 上游回调 → 订单支付 → 商户异步通知 ==');
    await waitFor(async () => merchantNotifies.length >= 1, 8000);
    const n0 = merchantNotifies[0];
    ok(n0 && n0.signValid === true && n0.params.trade_status === 'TRADE_SUCCESS', '商户 notify_url 收到合法签名回调');
    ok(n0 && n0.params.money === '12.34' && n0.params.out_trade_no === outM, '回调金额/订单号一致');
    r = await fetch(`${BASE}/api.php?act=order&pid=${shop.uid}&key=${shop.key}&trade_no=${tradeNoM}`);
    j = await r.json();
    ok(j.code === 1 && j.status === 1, '订单状态已变更为已支付');
    ok(j.money === '12.34', '订单金额正确');

    console.log('\n== 5. 幂等与余额 ==');
    // 重放上游回调 (构造同样的 notify)
    const replayParams = {
      pid: '1000', trade_no: 'UPREPLAY', out_trade_no: tradeNoM, type: 'alipay',
      name: '测试商品', money: '12.34', trade_status: 'TRADE_SUCCESS',
    };
    replayParams.sign = signParams(replayParams, UPSTREAM_KEY);
    replayParams.sign_type = 'MD5';
    r = await fetch(`${BASE}/channel/notify/epay/1?` + new URLSearchParams(replayParams));
    j = await r.text();
    ok(j === 'success', '重复回调响应 success (幂等)');
    const notifyCount = merchantNotifies.length;
    await sleep(1500);
    ok(merchantNotifies.length === notifyCount, '重复回调不会重复通知商户');
    r = await fetch(`${BASE}/api.php?act=order&pid=${shop.uid}&key=${shop.key}&trade_no=${tradeNoM}`);
    j = await r.json();
    ok(j.status === 1, '订单状态未被重复变更');
    // 商户余额 = 12.34
    r = await fetch(BASE + '/user/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'testshop', password: MERCHANT_PASS }) });
    merchantCookie = (r.headers.get('set-cookie') || '').split(';')[0];
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '12.34', `支付成功余额即时入账 (got ${j.data.money})`);

    console.log('\n== 6. VMQ 挂机流程 ==');
    const wxArgs = { ...orderArgs, type: 'wxpay', out_trade_no: 'SHOPW' + Date.now() };
    wxArgs.sign = signParams(wxArgs, shop.key);
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...wxArgs, sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1, 'VMQ 渠道下单成功');
    const wxTradeNo = j.trade_no;
    r = await fetch(BASE + '/cashier/' + wxTradeNo);
    const cashierHtml = await r.text();
    ok(r.status === 200 && cashierHtml.includes('12.34') && cashierHtml.includes('收银台'), '收银台页面渲染原版风格');
    r = await fetch(BASE + '/app/vmq/task?key=wrongkey&type=wxpay');
    j = await r.json();
    ok(j.code === -1, 'VMQ 错误 key 被拒绝');
    r = await fetch(BASE + '/app/vmq/task?key=vmqkey123&type=wxpay');
    j = await r.json();
    ok(j.code === 1 && j.trade_no === wxTradeNo && j.price === '12.34', '挂机端轮询取单正确');
    r = await fetch(BASE + `/app/vmq/push?key=vmqkey123&trade_no=${wxTradeNo}&price=9.99`);
    j = await r.text();
    ok(j.includes('金额不匹配'), 'VMQ 金额不匹配被拒绝');
    r = await fetch(BASE + `/app/vmq/push?key=vmqkey123&trade_no=${wxTradeNo}&price=12.34`);
    j = await r.text();
    ok(j === 'success', 'VMQ 推送到账成功');
    await waitFor(async () => merchantNotifies.length >= 2, 8000);
    ok(merchantNotifies[1] && merchantNotifies[1].signValid && merchantNotifies[1].params.out_trade_no === wxArgs.out_trade_no, 'VMQ 支付后商户收到回调');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '24.68', `VMQ 余额入账 (got ${j.data.money})`);

    console.log('\n== 7. syskey 签名查询 / 退款 ==');
    r = await fetch(`${BASE}/api.php?act=order&trade_no=${tradeNoM}&sign=${md5(syskey + tradeNoM + syskey)}`);
    j = await r.json();
    ok(j.code === 1 && j.trade_no === tradeNoM, 'syskey 签名查询订单 (原版协议兼容)');
    r = await fetch(`${BASE}/api.php?act=order&trade_no=${tradeNoM}&sign=bad`);
    j = await r.json();
    ok(j.code === -3, 'syskey 签名错误被拒绝');
    r = await fetch(`${BASE}/api.php?act=refundapi`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ trade_no: tradeNoM, money: '12.34', key: md5(tradeNoM + syskey + tradeNoM) }) });
    j = await r.json();
    ok(j.code === 0, '退款成功 (syskey 派生密钥)');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '12.34', `退款后余额扣回 (got ${j.data.money})`);
    r = await fetch(`${BASE}/api.php?act=refundapi`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ trade_no: tradeNoM, money: '12.34', key: md5(tradeNoM + syskey + tradeNoM) }) });
    j = await r.json();
    ok(j.code === -1, '重复退款被拒绝');
    r = await fetch(`${BASE}/api.php?act=refundapi`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ trade_no: tradeNoM, money: '12.34', key: 'badkey' }) });
    j = await r.json();
    ok(j.code === -1, '退款密钥错误被拒绝');

    console.log('\n== 8. 同步回跳 (return_url) 验签 ==');
    r = await fetch(BASE + '/payok/' + wxTradeNo, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    ok(r.status === 302 && loc.startsWith(`http://127.0.0.1:${MERCHANT_PORT}/return?`), 'payok 302 跳转商户 return_url');
    if (loc) { try { await fetch(loc); } catch {} }
    await sleep(300);
    const ret = merchantReturns.find((x) => x.params.trade_no === wxTradeNo);
    ok(ret && ret.signValid === true && ret.params.trade_status === 'TRADE_SUCCESS', '商户 return_url 收到合法签名参数');

    console.log('\n== 9. 结算流程 ==');
    r = await fetch(BASE + '/user/api/settle', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: merchantCookie }, body: JSON.stringify({ amount: '100' }) });
    j = await r.json();
    ok(j.code === -1, '超额结算被拒绝');
    r = await fetch(BASE + '/user/api/settle', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: merchantCookie }, body: JSON.stringify({ amount: '5.00' }) });
    j = await r.json();
    ok(j.code === 0, '结算申请成功');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '7.34', `结算冻结余额 (got ${j.data.money})`);
    r = await fetch(BASE + '/admin/api/settles', { headers: { Cookie: adminCookie } });
    j = await r.json();
    const sid = j.data[0].id;
    ok(j.data[0].status === 0 && j.data[0].username === 'testshop', '管理员可见待处理结算');
    r = await fetch(BASE + '/admin/api/settles/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ id: sid, status: 2 }) });
    j = await r.json();
    ok(j.code === 0, '结算驳回');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '12.34', `驳回后退回余额 (got ${j.data.money})`);

    console.log('\n== 10. 商户注册 / Cron / 静态页 ==');
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newshop1', password: 'abc123456' }) });
    j = await r.json();
    ok(j.code === 0 && j.data.key, '开放注册成功');
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newshop1', password: 'abc123456' }) });
    j = await r.json();
    ok(j.code === -1, '重复注册被拒绝');
    r = await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ cron_token: 'crontoken123' }) });
    await r.json();
    r = await fetch(BASE + '/api/cron?token=crontoken123');
    j = await r.json();
    ok(j.code === 0, '通知重试 cron 正常');
    r = await fetch(BASE + '/api/cron?token=bad');
    j = await r.json();
    ok(j.code === -1, 'cron token 错误被拒绝');
    r = await fetch(BASE + '/admin.html');
    ok(r.status === 200 && (await r.text()).includes('支付管理中心'), 'admin.html 原版风格页面');
    r = await fetch(BASE + '/user.html');
    ok(r.status === 200 && (await r.text()).includes('商户管理中心'), 'user.html 原版风格页面');
    r = await fetch(BASE + '/assets/vendor/jquery/3.4.1/jquery.min.js');
    ok(r.status === 200, '静态资源直出');
  } catch (e) {
    fail++;
    failures.push('异常中断: ' + e.message);
    console.error(e);
  } finally {
    wr.kill('SIGTERM');
    upServer.close(); mcServer.close();
  }

  console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) { console.log('失败项:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
}

main();
