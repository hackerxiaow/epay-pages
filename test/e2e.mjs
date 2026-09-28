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

// ---- 新增 mock 状态与工具 ----
const WX_KEY = 'wxpaykey123456789012345678901234';
const wxOrders = [];
const alipayOrders = [];
const emails = [];
const mockBills = []; // {id, timeStr, amount}
const mockTronTransfers = []; // 波场链上入账记录 {transaction_id, to, value, block_timestamp}
// ---- BEpusdt 网关 mock ----
const BE_TOKEN = 'bepusdt_token_mock_123456';
const bepusdtHits = []; // 收到的 create-transaction 请求
/** BEpusdt 签名: 非空且非 signature 的参数按 ASCII 升序拼 k=v&, 末尾追加令牌, MD5 小写 */
function bepusdtSign(params, token) {
  const raw = Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return md5(raw + token);
}
function signStr(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}
function wxSign(params, key) {
  return md5(Object.keys(params).filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== undefined).sort().map((k) => `${k}=${params[k]}`).join('&') + '&key=' + key).toUpperCase();
}
function parseXml(xml) {
  const out = {};
  const cdata = /<([a-zA-Z0-9_]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g;
  let m;
  while ((m = cdata.exec(xml))) out[m[1]] = m[2];
  if (Object.keys(out).length === 0) {
    const plain = /<([a-zA-Z0-9_]+)>([^<]+)<\/\1>/g;
    while ((m = plain.exec(xml))) out[m[1]] = m[2];
  }
  return out;
}
function toXml(params) {
  return '<xml>' + Object.keys(params).map((k) => `<${k}><![CDATA[${params[k]}]]></${k}>`).join('') + '</xml>';
}
function postForm(url, params) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end(new URLSearchParams(params).toString());
  });
}
function postXml(url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'text/xml' } }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end(body);
  });
}

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
  if (u.pathname === '/pay/unifiedorder' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = parseXml(body);
      const sign = p.sign; delete p.sign;
      const valid = wxSign(p, WX_KEY) === sign;
      wxOrders.push({ ...p, signValid: valid });
      const n = { appid: p.appid, bank_type: 'CMB_CREDIT', cash_fee: p.total_fee, fee_type: 'CNY', is_subscribe: 'N', mch_id: p.mch_id, nonce_str: 'mocknonce', out_trade_no: p.out_trade_no, result_code: 'SUCCESS', return_code: 'SUCCESS', time_end: '20260927120000', total_fee: p.total_fee, trade_type: 'NATIVE', transaction_id: 'WXMOCK' + Date.now() };
      n.sign = wxSign(n, WX_KEY);
      if (p.notify_url) postXml(p.notify_url, toXml(n));
      const resp = { return_code: 'SUCCESS', result_code: 'SUCCESS', appid: p.appid, mch_id: p.mch_id, nonce_str: 'mock', prepay_id: 'mockprepay', trade_type: 'NATIVE', code_url: 'weixin://wxpay/mock/' + p.out_trade_no };
      resp.sign = wxSign(resp, WX_KEY);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(toXml(resp));
    });
    return;
  }
  if (u.pathname === '/gateway.do' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      const sign = p.sign; delete p.sign; delete p.sign_type;
      globalThis.__lastAlipayReq = { ...p, rawSign: sign, rawStr: signStr(p) };
      // 官方账单查询 (免CK模式): 按请求公钥验签, 返回 mockBills 流水
      if (p.method === 'alipay.data.bill.accountlog.query') {
        const pubKey = globalThis.__aliApiPub;
        const okSign = pubKey ? crypto.createVerify('RSA-SHA256').update(signStr(p)).verify(pubKey, sign, 'base64') : false;
        globalThis.__aliApiSignValid = okSign;
        const inner = {
          code: '10000', msg: 'Success',
          bill_transaction_list: { list: mockBills.map((b) => ({ trans_dt: b.timeStr, trans_amount: b.amount, trans_status: '交易成功', trade_no: b.id })) },
        };
        const respSign = crypto.createSign('RSA-SHA256').update(JSON.stringify(inner)).sign(globalThis.__aliApiPriv || globalThis.__aliPriv, 'base64');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ alipay_data_bill_accountlog_query_response: inner, sign: respSign }));
        return;
      }
      // 当面付预下单
      const inner = { code: '10000', msg: 'Success', out_trade_no: p.out_trade_no, qr_code: 'https://qr.alipay.com/mock_' + p.out_trade_no };
      const innerStr = JSON.stringify(inner);
      const respSign = crypto.createSign('RSA-SHA256').update(innerStr).sign(globalThis.__aliPriv, 'base64');
      // 异步通知
      if (globalThis.__aliNotifyUrl) {
        const biz = JSON.parse(p.biz_content || '{}');
        const n = { app_id: p.app_id, trade_no: 'ALIMOCK' + Date.now(), out_trade_no: biz.out_trade_no, total_amount: biz.total_amount, trade_status: 'TRADE_SUCCESS' };
        const nsign = crypto.createSign('RSA-SHA256').update(signStr(n)).sign(globalThis.__aliPriv, 'base64');
        postForm(globalThis.__aliNotifyUrl, { ...n, sign: nsign, sign_type: 'RSA2' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ alipay_trade_pre_create_response: inner, sign: respSign }));
    });
    return;
  }
  if (u.pathname === '/finance/record.htm') {
    const rows = mockBills.map((b) => `<tr class="bill"><td class="time">${b.timeStr}</td><td class="amount">¥${b.amount}</td><td class="type">收入</td></tr>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><table>${rows}</table></body></html>`);
    return;
  }
  if (u.pathname === '/setbill' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = JSON.parse(body);
      mockBills.push({ id: 'MOCKB' + Date.now(), timeStr: p.timeStr, amount: p.amount });
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (u.pathname === '/emailcode' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      emails.push(JSON.parse(body));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  // BEpusdt 网关 (v03413/BEpusdt 协议): signature 在 body 里, 响应 { status_code, message, data }
  if (u.pathname === '/api/v1/order/create-transaction' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = JSON.parse(body);
      const sign = p.signature;
      delete p.signature;
      bepusdtHits.push({ ...p, signValid: bepusdtSign(p, BE_TOKEN) === sign });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status_code: 200,
        message: 'success',
        data: {
          fiat: p.fiat || 'CNY',
          trade_id: 'BE' + Date.now(),
          order_id: p.order_id,
          amount: String(p.amount),
          actual_amount: (Number(p.amount) / 7.2).toFixed(4),
          token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          status: 1,
          expiration_time: 600,
          payment_url: `http://127.0.0.1:${UPSTREAM_PORT}/pay/checkout-counter/BE${Date.now()}`,
        },
        request_id: '',
      }));
    });
    return;
  }
  // TronGrid TRC20 查链 mock
  if (u.pathname.includes('/transactions/trc20')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: mockTronTransfers,
      success: true,
      meta: { at: Date.now(), page_size: 20 },
    }));
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
  execSync('npx wrangler d1 execute epay-db --local --file=migrate-v2.sql', { cwd: process.cwd(), stdio: 'pipe' });

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
    ok(r.status === 200 && cashierHtml.includes('收银台'), '收银台页面渲染原版风格');
    r = await fetch(BASE + '/app/vmq/task?key=wrongkey&type=wxpay');
    j = await r.json();
    ok(j.code === -1, 'VMQ 错误 key 被拒绝');
    r = await fetch(BASE + '/app/vmq/task?key=vmqkey123&type=wxpay');
    j = await r.json();
    const vmqPrice = j.price;
    ok(j.code === 1 && j.trade_no === wxTradeNo && parseFloat(vmqPrice) > 12.34 && parseFloat(vmqPrice) <= 13.33, '挂机端轮询取单正确(含尾数)');
    ok(cashierHtml.includes(vmqPrice), '收银台展示尾数应付金额');
    r = await fetch(BASE + `/app/vmq/push?key=vmqkey123&trade_no=${wxTradeNo}&price=9.99`);
    j = await r.text();
    ok(j.includes('金额不匹配'), 'VMQ 金额不匹配被拒绝');
    r = await fetch(BASE + `/app/vmq/push?key=vmqkey123&trade_no=${wxTradeNo}&price=${vmqPrice}`);
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

    console.log('\n== 11. RSA2 商户接入 ==');
    // 平台密钥对
    r = await fetch(BASE + '/admin/api/rsa/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: '{}' });
    j = await r.json();
    ok(j.code === 0 && j.data.publicPem.includes('PUBLIC KEY'), '平台RSA密钥对生成');
    const platformPub = j.data.publicPem;
    // 商户RSA
    r = await fetch(BASE + '/admin/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ username: 'rsashop', password: 'rsa12345678' }) });
    j = await r.json(); ok(j.code === 0, '创建RSA商户');
    r = await fetch(BASE + '/admin/api/users', { headers: { Cookie: adminCookie } });
    const rsaShop = (await r.json()).data.list.find((u) => u.username === 'rsashop');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    r = await fetch(BASE + '/admin/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ uid: rsaShop.uid, keytype: 1, publickey: publicKey }) });
    ok((await r.json()).code === 0, '商户绑定RSA公钥');
    // RSA 签名下单
    const rsaArgs = { pid: String(rsaShop.uid), type: 'alipay', out_trade_no: 'RSASHOP' + Date.now(), notify_url: `http://127.0.0.1:${MERCHANT_PORT}/notify`, return_url: `http://127.0.0.1:${MERCHANT_PORT}/return`, name: 'RSA测试', money: '6.66' };
    const rsaSignStr = signStr(rsaArgs);
    const rsaSignB64 = crypto.createSign('RSA-SHA256').update(rsaSignStr).sign(privateKey, 'base64');
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...rsaArgs, sign: rsaSignB64, sign_type: 'RSA' }) });
    j = await r.json();
    ok(j.code === 1, 'RSA2 签名下单成功');
    const rsaTradeNo = j.trade_no;
    // 平台对 RSA 商户的通知应可由商户公钥体系验证: 平台私钥签名, 商户用平台公钥验证
    await waitFor(async () => merchantNotifies.length >= 1 && merchantNotifies.some((x) => x.params.out_trade_no === rsaArgs.out_trade_no), 8000);
    const rsaNotify = merchantNotifies.find((x) => x.params.out_trade_no === rsaArgs.out_trade_no);
    if (rsaNotify) {
      const { sign: ns, sign_type: nst, ...np } = rsaNotify.params;
      const v = crypto.createVerify('RSA-SHA256').update(signStr(np)).verify(platformPub, ns, 'base64');
      ok(v && nst === 'RSA', '平台对RSA商户的通知签名可验证 (sign_type=RSA)');
    } else ok(false, 'RSA商户未收到通知');

    console.log('\n== 12. 微信 Native 官方渠道 (V2, mock) ==');
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'wxpaynative', name: '微信官方', config: { appid: 'wxmock123', mchid: '1900001', key: WX_KEY, api_base: `http://127.0.0.1:${UPSTREAM_PORT}` } }) });
    ok((await r.json()).code === 0, '创建微信Native渠道');
    r = await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } });
    const wxCh = r.json ? null : null;
    let channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const wxChId = channelsList.find((x) => x.plugin === 'wxpaynative').id;
    const f2fIdTmp = null;
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: 1, wxpay: wxChId }) }) });
    const wxnArgs = { ...orderArgs, type: 'wxpay', out_trade_no: 'WXPAY' + Date.now(), money: '7.77' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...wxnArgs, sign: signParams(wxnArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.qrcode.startsWith('weixin://'), '微信Native下单返回code_url');
    ok(wxOrders.length >= 1 && wxOrders[0].signValid === true, '我方对微信下单签名正确(V2协议)');
    ok(wxOrders[0].total_fee === '777' && wxOrders[0].body === '测试商品', '金额分/商品名正确');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === wxnArgs.out_trade_no), 8000);
    const wxNotify = merchantNotifies.find((x) => x.params.out_trade_no === wxnArgs.out_trade_no);
    ok(wxNotify && wxNotify.signValid, '微信回调→订单支付→商户通知成功');

    console.log('\n== 13. 支付宝当面付 (官方协议, mock) ==');
    const aliApp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const aliSrv = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    globalThis.__aliAppPub = aliApp.publicKey;
    globalThis.__aliPriv = aliSrv.privateKey;
    const f2fNotifyUrl = `${BASE.replace('127.0.0.1:8787', '127.0.0.1:8787')}/channel/notify/alipayf2f/0`;
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'alipayf2f', name: '当面付', config: { appid: '20210001', private_key: aliApp.privateKey, alipay_public_key: aliSrv.publicKey, gateway: `http://127.0.0.1:${UPSTREAM_PORT}/gateway.do`, enable_transfer: '1' } }) });
    ok((await r.json()).code === 0, '创建当面付渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const f2fChId = channelsList.find((x) => x.plugin === 'alipayf2f').id;
    globalThis.__aliNotifyUrl = `${BASE}/channel/notify/alipayf2f/${f2fChId}`;
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: f2fChId, wxpay: wxChId }) }) });
    const f2fArgs = { ...orderArgs, type: 'alipay', out_trade_no: 'F2F' + Date.now(), money: '8.88' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...f2fArgs, sign: signParams(f2fArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    if (j.code !== 1) console.log('   [debug f2f mapi]', JSON.stringify(j));
    ok(j.code === 1 && j.qrcode.startsWith('https://qr.alipay.com'), '当面付下单返回二维码');
    if (globalThis.__lastAlipayReq) console.log('   [debug aliReq keys]', Object.keys(globalThis.__lastAlipayReq).join(','), '| biz_content =', globalThis.__lastAlipayReq.biz_content);
    const aliReq = globalThis.__lastAlipayReq;
    const aliVerify = crypto.createVerify('RSA-SHA256').update(aliReq.rawStr).verify(aliApp.publicKey, aliReq.rawSign, 'base64');
    ok(aliVerify && aliReq.method === 'alipay.trade.pre.create', '我方对支付宝请求RSA2签名正确');
    ok(JSON.parse(aliReq.biz_content).out_trade_no === j.trade_no && JSON.parse(aliReq.biz_content).total_amount === '8.88', 'biz_content 参数正确 (平台单号/金额)');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === f2fArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === f2fArgs.out_trade_no), '支付宝回调→订单支付→商户通知成功');

    console.log('\n== 14. 渠道加权轮询 ==');
    // f2f 权重3, epay 权重1
    const epayChId = channelsList.find((x) => x.plugin === 'epay').id;
    const f2fCfg = JSON.parse(channelsList.find((x) => x.plugin === 'alipayf2f').config);
    await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ id: f2fChId, plugin: 'alipayf2f', name: '当面付', config: f2fCfg, weight: 3 }) });
    await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ id: epayChId, plugin: 'epay', name: '测试上游', config: { url: `http://127.0.0.1:${UPSTREAM_PORT}`, pid: '1000', key: UPSTREAM_KEY }, weight: 1 }) });
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: `${epayChId},${f2fChId}`, wxpay: wxChId }) }) });
    // 独立商户 wshop 承接轮询订单, 不污染 testshop 余额断言
    await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'wshop', password: 'wshop123456' }) });
    let wshopList = (await (await fetch(BASE + '/admin/api/users', { headers: { Cookie: adminCookie } })).json()).data.list;
    const wshop = wshopList.find((u) => u.username === 'wshop');
    const seen = new Set();
    for (let i = 0; i < 40 && !(seen.has('epay') && seen.has('f2f')); i++) {
      const a = { pid: String(wshop.uid), type: 'alipay', out_trade_no: 'W' + i + Date.now(), notify_url: `http://127.0.0.1:${MERCHANT_PORT}/notify`, return_url: `http://127.0.0.1:${MERCHANT_PORT}/return`, name: '轮询', money: '1.01' };
      r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...a, sign: signParams(a, wshop.key), sign_type: 'MD5' }) });
      j = await r.json();
      if (j.code === 1) seen.add(j.payurl ? 'epay' : 'f2f');
    }
    ok(seen.has('epay') && seen.has('f2f'), '多渠道加权轮询生效 (两种渠道均命中)');

    console.log('\n== 15. 风控: 黑名单 / 域名白名单 ==');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ blacklist: '127.0.0.1' }) });
    const blArgs = { ...orderArgs, out_trade_no: 'BL' + Date.now() };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...blArgs, sign: signParams(blArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === -1 && j.msg === '请求被拒绝', 'IP黑名单拦截');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ blacklist: '' }) });
    await fetch(BASE + '/admin/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ uid: shop.uid, domain: 'shop.com' }) });
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ auth_domain: '1' }) });
    const dmArgs = { ...orderArgs, out_trade_no: 'DM' + Date.now() };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', body: new URLSearchParams({ ...dmArgs, sign: signParams(dmArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === -1 && j.msg === '来源域名未授权', '域名白名单: 未授权来源被拒');
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { Referer: 'http://shop.com/buy' }, body: new URLSearchParams({ ...dmArgs, out_trade_no: 'DM2' + Date.now(), sign: signParams({ ...dmArgs, out_trade_no: 'DM2' + Date.now() }, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1, '域名白名单: 授权来源放行');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ auth_domain: '0' }) });

    console.log('\n== 16. 分组费率 + 邀请返利 ==');
    r = await fetch(BASE + '/admin/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ name: 'VIP', rate: 10 }) });
    j = await r.json(); ok(j.code === 0, '创建费率分组');
    r = await fetch(BASE + '/admin/api/groups', { headers: { Cookie: adminCookie } });
    const vipGid = (await r.json()).data.find((g) => g.name === 'VIP').id;
    // 邀请注册
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'invshop', password: 'inv1234567', invite: 'testshop' }) });
    j = await r.json(); ok(j.code === 0, '邀请注册成功');
    const invCookie = (r.headers.get('set-cookie') || '').split(';')[0];
    r = await fetch(BASE + '/admin/api/users', { headers: { Cookie: adminCookie } });
    const invUid = (await r.json()).data.list.find((u) => u.username === 'invshop').uid;
    await fetch(BASE + '/admin/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ uid: invUid, gid: vipGid }) });
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ invite_rate: '10' }) });
    // invshop 10.00 订单 (微信渠道已由 mock 支付)
    const invArgs = { pid: String(invUid), type: 'wxpay', out_trade_no: 'INV' + Date.now(), notify_url: `http://127.0.0.1:${MERCHANT_PORT}/notify`, return_url: `http://127.0.0.1:${MERCHANT_PORT}/return`, name: '费率测试', money: '10.00' };
    // invshop key 用管理员接口拿
    r = await fetch(BASE + '/admin/api/users', { headers: { Cookie: adminCookie } });
    const invKey = (await r.json()).data.list.find((u) => u.username === 'invshop').key;
    const invArgs2 = { ...invArgs, sign: signParams(invArgs, invKey) };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(invArgs2) });
    j = await r.json();
    ok(j.code === 1, '费率分组商户下单成功');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === invArgs.out_trade_no), 8000);
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: invCookie } });
    j = await r.json();
    ok(j.data.money === '9.00', `分组费率10%扣手续费后入账9.00 (got ${j.data.money})`);
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    const expectRebate = 12.34 + 12.34 + 7.77 + 8.88 + 1.00; // 退款后余额 + VMQ单 + 微信单 + 面付单 + 白名单放行单 + 返利1.00
    ok(Math.abs(parseFloat(j.data.money) - expectRebate) < 0.001, `邀请返利10%到账 (got ${j.data.money}, expect ${expectRebate.toFixed(2)})`);

    console.log('\n== 17. 实名认证 ==');
    r = await fetch(BASE + '/user/api/cert', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: invCookie }, body: JSON.stringify({ name: '张三', idcard: '350100199001011234' }) });
    j = await r.json(); ok(j.code === 0, '提交实名认证');
    r = await fetch(BASE + '/admin/api/certs', { headers: { Cookie: adminCookie } });
    const certs = (await r.json()).data;
    ok(certs.some((x) => x.uid === invUid && x.cert_name === '张三'), '管理员可见待审实名');
    await fetch(BASE + '/admin/api/certs/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ uid: invUid, status: 2 }) });
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: invCookie } });
    j = await r.json();
    ok(j.data.cert === 2, '实名审核通过');
    // 强制实名拦截未认证商户
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ cert_force: '1' }) });
    const cfArgs = { ...orderArgs, out_trade_no: 'CF' + Date.now() };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...cfArgs, sign: signParams(cfArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === -1 && j.msg.includes('实名'), '强制实名: 未认证商户下单被拒');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ cert_force: '0' }) });

    console.log('\n== 18. 验证码 / 邮箱 / 杂项 ==');
    r = await fetch(BASE + '/api/captcha');
    j = await r.json();
    const capMatch = j.data.svg.match(/(\d+) \+ (\d+)/);
    ok(j.code === 0 && capMatch, '图形验证码接口');
    // 图形验证码注册
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ captcha_open: '1' }) });
    r = await fetch(BASE + '/api/captcha');
    j = await r.json();
    const m2 = j.data.svg.match(/(\d+) \+ (\d+)/);
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'capshop', password: 'cap1234567', captcha_id: j.data.id, captcha_answer: String(Number(m2[1]) + Number(m2[2])) }) });
    j = await r.json();
    ok(j.code === 0, '图形验证码注册成功');
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'capshop2', password: 'cap1234567', captcha_id: 'x', captcha_answer: '9' }) });
    j = await r.json();
    ok(j.code === -1, '图形验证码错误被拒');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ captcha_open: '0' }) });
    // 邮箱验证码
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ email_verify: '1', email_webhook: `http://127.0.0.1:${UPSTREAM_PORT}/emailcode` }) });
    r = await fetch(BASE + '/user/api/sendcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com' }) });
    j = await r.json();
    ok(j.code === 0, '邮箱验证码发送');
    await waitFor(async () => emails.length >= 1, 6000);
    ok(emails.length >= 1 && emails[emails.length - 1].email === 'a@b.com' && /^\d{6}$/.test(emails[emails.length - 1].code), 'webhook 收到验证码');
    r = await fetch(BASE + '/user/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mailshop', password: 'mail1234567', email: 'a@b.com', email_code: emails[emails.length - 1].code }) });
    j = await r.json();
    ok(j.code === 0, '邮箱验证码注册成功');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ email_verify: '0' }) });
    // 公告
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ announcement: '系统测试公告ABC' }) });
    r = await fetch(BASE + '/api/announcement');
    j = await r.json();
    ok(j.data === '系统测试公告ABC', '平台公告');
    // 文档页/码牌
    r = await fetch(BASE + '/doc');
    ok(r.status === 200 && (await r.text()).includes('接入文档'), '接入文档页');
    r = await fetch(BASE + `/pay/${shop.uid}`);
    ok(r.status === 200 && (await r.text()).includes('输入金额'), '码牌收款页');
    r = await fetch(BASE + `/paygo/${shop.uid}?money=3.21&type=alipay`, { redirect: 'manual' });
    ok(r.status === 302 && (r.headers.get('location') || '').startsWith('/cashier/'), '码牌下单跳收银台');
    // 导出/统计/趋势
    r = await fetch(BASE + '/admin/api/export?days=30', { headers: { Cookie: adminCookie } });
    const csv = await r.text();
    ok(csv.includes('平台订单号') && csv.split('\n').length > 3, '订单导出CSV');
    r = await fetch(BASE + '/admin/api/buyerstat', { headers: { Cookie: adminCookie } });
    j = await r.json();
    ok(j.code === 0 && j.data.length >= 1, '支付用户统计');
    r = await fetch(BASE + '/admin/api/trend', { headers: { Cookie: adminCookie } });
    j = await r.json();
    ok(j.code === 0, '7日趋势');


    console.log('\n== 19. 支付宝个人码账单轮询 (免挂机) ==');
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'alipaybill', name: '个人码轮询', config: { cookie: 'mockcookie=1', bill_url: `http://127.0.0.1:${UPSTREAM_PORT}/finance/record.htm`, qrcode_alipay: 'https://img.example/aliqr.png', pay_suffix: '1' } }) });
    ok((await r.json()).code === 0, '创建账单轮询渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const billChId = channelsList.find((x) => x.plugin === 'alipaybill').id;
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: billChId, wxpay: wxChId }) }) });
    const billArgs = { ...orderArgs, out_trade_no: 'BILLT' + Date.now(), money: '5.54' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...billArgs, sign: signParams(billArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.qrcode === 'https://img.example/aliqr.png', '轮询渠道下单返回收款码');
    const billTradeNo = j.trade_no;
    // 收银台应展示带尾数的应付金额
    r = await fetch(BASE + '/cashier/' + billTradeNo);
    const billCashier = await r.text();
    const payMatch = billCashier.match(/data-pay="([\d.]+)"/);
    const payVal = payMatch ? parseFloat(payMatch[1]) : 0;
    ok(r.status === 200 && payVal >= 5.55 && payVal <= 6.53 && payVal !== 5.54, '收银台展示唯一尾数金额');
    // 金额不匹配的账单不应触发支付
    const bj = (d) => new Date(Date.now() + 8 * 3600000 + d).toISOString().slice(0, 19).replace('T', ' ');
    await new Promise((resolve) => {
      const u = new URL(`http://127.0.0.1:${UPSTREAM_PORT}/setbill`);
      const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res2) => { res2.resume(); resolve(); });
      rq.end(JSON.stringify({ amount: '9.99', timeStr: bj(0) }));
    });
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + billTradeNo);
    j = await r.json();
    await sleep(1500);
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + billTradeNo);
    j = await r.json();
    ok(j.status === 0, '不匹配金额不触发支付');
    // 放入匹配尾数的账单 -> 轮询自动确认
    await new Promise((resolve) => {
      const u = new URL(`http://127.0.0.1:${UPSTREAM_PORT}/setbill`);
      const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res2) => { res2.resume(); resolve(); });
      rq.end(JSON.stringify({ amount: payMatch[1], timeStr: bj(0) }));
    });
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + billTradeNo);
      return (await rr.json()).status >= 1;
    }, 15000);
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + billTradeNo);
    j = await r.json();
    ok(j.status === 1, '账单轮询自动确认订单 (免挂机)');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === billArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === billArgs.out_trade_no), '轮询支付后商户收到通知');
    // 商户余额按原始订单金额入账 (尾数不计入商户)
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '47.87', `余额按订单原金额入账 (got ${j.data.money}, expect 47.87)`);


    console.log('\n== 20. 码支付平台兼容 (submit 跳转模式) ==');
    // mock 上游不实现 mapi.php 的场景: 建一个纯网页收银台的码支付渠道
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'epay', name: '码支付(submit)', config: { url: `http://127.0.0.1:${UPSTREAM_PORT}`, pid: '2000', key: UPSTREAM_KEY, api_mode: 'submit' } }) });
    ok((await r.json()).code === 0, '创建码支付 submit 模式渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const codePayChId = channelsList.filter((x) => x.plugin === 'epay').map((x) => x.id).pop();
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: codePayChId, wxpay: wxChId }) }) });
    const cpArgs = { ...orderArgs, out_trade_no: 'CODEPAY' + Date.now(), money: '3.33' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...cpArgs, sign: signParams(cpArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.payurl.includes('/submit.php?') && j.payurl.includes('sign='), 'submit 模式返回上游收银台跳转链接');
    // 上游回调路径不变: 直接模拟码支付回调
    const cpNotify = { pid: '2000', trade_no: 'CP' + Date.now(), out_trade_no: j.trade_no, type: 'alipay', name: cpArgs.name, money: '3.33', trade_status: 'TRADE_SUCCESS' }; // 上游回传平台单号(协议行为)
    cpNotify.sign = signParams(cpNotify, UPSTREAM_KEY);
    cpNotify.sign_type = 'MD5';
    r = await fetch(`${BASE}/channel/notify/epay/${codePayChId}?` + new URLSearchParams(cpNotify));
    ok((await r.text()) === 'success', '码支付回调验签并确认订单');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === cpArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === cpArgs.out_trade_no), '码支付订单商户收到通知');


    console.log('\n== 21. 支付宝免CK模式 (开放平台官方账单API) ==');
    const apiApp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const apiSrv = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    globalThis.__aliApiPub = apiApp.publicKey;
    globalThis.__aliApiPriv = apiSrv.privateKey;
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'alipaybill', name: '个人码免CK', config: { appid: '2021000199999999', private_key: apiApp.privateKey, alipay_public_key: apiSrv.publicKey, gateway: `http://127.0.0.1:${UPSTREAM_PORT}/gateway.do`, user_id: '2088123456789012', qrcode_alipay: 'https://img.example/apiqr.png' } }) });
    ok((await r.json()).code === 0, '创建免CK渠道(开放平台密钥)');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const apiChId = channelsList.filter((x) => x.plugin === 'alipaybill').map((x) => x.id).pop();
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: apiChId, wxpay: wxChId }) }) });
    const apiArgs = { ...orderArgs, out_trade_no: 'APIBILL' + Date.now(), money: '4.44' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...apiArgs, sign: signParams(apiArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.qrcode === 'https://img.example/apiqr.png', '免CK渠道下单返回收款码');
    const apiTradeNo = j.trade_no;
    r = await fetch(BASE + '/cashier/' + apiTradeNo);
    const apiCashier = await r.text();
    const apiPay = (apiCashier.match(/data-pay="([\d.]+)"/) || [])[1];
    ok(!!apiPay && parseFloat(apiPay) >= 4.45 && parseFloat(apiPay) <= 5.43, '收银台尾数金额展示');
    ok(apiCashier.includes('alipays://platformapi/startapp') && apiCashier.includes('amount=') && apiCashier.includes('2088123456789012'), '免输金额转账链接(唤起支付宝并带金额)');
    // 放入匹配账单 -> 官方API轮询确认
    await new Promise((resolve) => {
      const u = new URL(`http://127.0.0.1:${UPSTREAM_PORT}/setbill`);
      const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res2) => { res2.resume(); resolve(); });
      rq.end(JSON.stringify({ amount: apiPay, timeStr: bj(0) }));
    });
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + apiTradeNo);
      return (await rr.json()).status >= 1;
    }, 20000);
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + apiTradeNo);
    j = await r.json();
    ok(j.status === 1, '官方账单API轮询自动确认 (免CK免挂机)');
    ok(globalThis.__aliApiSignValid === true, '我方对官方账单API的RSA2请求签名正确');
    ok(globalThis.__lastAlipayReq.method === 'alipay.data.bill.accountlog.query' && globalThis.__lastAlipayReq.biz_content.includes('bill_date'), 'accountlog.query 请求参数正确');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === apiArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === apiArgs.out_trade_no), '免CK订单商户收到通知');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '55.64', `余额对账 (got ${j.data.money}, expect 55.64)`);


    console.log('\n== 22. 原版V免签App兼容协议 ==');
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'vmq', name: '原版App', config: { key: 'vmqkey456', qrcode_alipay: 'https://img.example/a.png', qrcode_wxpay: 'https://img.example/w.png' } }) });
    ok((await r.json()).code === 0, '创建原版App用VMQ渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const vmq2Id = channelsList.filter((x) => x.plugin === 'vmq').map((x) => x.id).pop();
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: apiChId, wxpay: vmq2Id }) }) });
    const appArgs = { ...orderArgs, type: 'wxpay', out_trade_no: 'VMQAPP' + Date.now(), money: '2.22' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...appArgs, sign: signParams(appArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1, '原版App渠道下单成功');
    const appTradeNo = j.trade_no;
    const t = String(Date.now());
    r = await fetch(`${BASE}/appHeart?t=${t}&sign=${md5(t + 'vmqkey456')}`);
    j = await r.json();
    ok(j.code === 1, 'App 心跳 (appHeart) 正常');
    r = await fetch(`${BASE}/appHeart?t=${t}&sign=bad`);
    j = await r.json();
    ok(j.code === -1, 'App 心跳错误签名被拒');
    r = await fetch(`${BASE}/getState?t=${t}&sign=${md5(t + 'vmqkey456')}`);
    j = await r.json();
    ok(j.code === 1 && j.data.state === '1', 'App 监听状态 (getState) 正常');
    // 原版推送: type 1=微信, 金额需含尾数 -> 先查待支付金额
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + appTradeNo);
    // 从收银台拿尾数
    r = await fetch(BASE + '/cashier/' + appTradeNo);
    const appPay = ((await r.text()).match(/data-pay="([\d.]+)"/) || [])[1];
    ok(!!appPay && parseFloat(appPay) > 2.22 && parseFloat(appPay) <= 3.21, '收银台展示尾数金额');
    const t2 = String(Date.now());
    const badPush = { type: '1', price: '9.87', t: t2, sign: md5(`1${'9.87'}${t2}vmqkey456`) };
    r = await fetch(`${BASE}/appPush?` + new URLSearchParams(badPush));
    j = await r.json();
    ok(j.code === 1, '无匹配金额推送不报错(原版行为)');
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + appTradeNo);
    j = await r.json();
    ok(j.status === 0, '无匹配金额不确认订单');
    const goodPush = { type: '1', price: appPay, t: t2, sign: md5(`1${appPay}${t2}vmqkey456`) };
    r = await fetch(`${BASE}/appPush?` + new URLSearchParams(goodPush));
    j = await r.json();
    ok(j.code === 1, '原版 App 推送到账成功');
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + appTradeNo);
      return (await rr.json()).status >= 1;
    }, 8000);
    ok(true, '订单自动确认');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === appArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === appArgs.out_trade_no), '原版App支付后商户收到通知');
    r = await fetch(BASE + '/user/api/me', { headers: { Cookie: merchantCookie } });
    j = await r.json();
    ok(j.data.money === '57.86', `余额对账 (got ${j.data.money}, expect 57.86)`);


    console.log('\n== 23. QQ钱包账单轮询 + OneBot上报 + 首页统计 ==');
    // QQ账单轮询渠道
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'qqbill', name: 'QQ钱包轮询', config: { cookie: 'qq=1', bill_url: `http://127.0.0.1:${UPSTREAM_PORT}/finance/record.htm`, qrcode_qqpay: 'https://img.example/qq.png' } }) });
    ok((await r.json()).code === 0, '创建QQ账单轮询渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const qqBillChId = channelsList.find((x) => x.plugin === 'qqbill').id;
    // OneBot token
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ onebot_token: 'obtoken123', channel_map: JSON.stringify({ alipay: apiChId, wxpay: vmq2Id, qqpay: qqBillChId }) }) });
    // QQ订单
    const qqArgs = { ...orderArgs, type: 'qqpay', out_trade_no: 'QQPAY' + Date.now(), money: '9.13' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...qqArgs, sign: signParams(qqArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1 && j.qrcode === 'https://img.example/qq.png', 'QQ渠道下单返回收款码');
    const qqTradeNo = j.trade_no;
    // OneBot 错误token
    r = await fetch(BASE + '/onebot/report?token=bad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_message: '您收到一笔转账 9.99元' }) });
    ok(r.status === 403, 'OneBot 错误token被拒');
    // 不匹配金额
    r = await fetch(BASE + '/onebot/report?token=obtoken123', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_message: 'QQ钱包通知：您收到一笔转账，金额9.99元' }) });
    j = await r.json();
    ok(j.status === 'no_match', 'OneBot 金额不匹配忽略');
    // 匹配尾数: 从收银台拿
    r = await fetch(BASE + '/cashier/' + qqTradeNo);
    const qqPay = ((await r.text()).match(/data-pay="([\d.]+)"/) || [])[1];
    r = await fetch(BASE + '/onebot/report?token=obtoken123', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_message: `QQ钱包通知：您收到一笔转账，金额${qqPay}元` }) });
    j = await r.json();
    ok(j.status === 'ok', 'OneBot QQ到账自动确认');
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + qqTradeNo);
      return (await rr.json()).status >= 1;
    }, 8000);
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === qqArgs.out_trade_no), 8000);
    ok(merchantNotifies.some((x) => x.params.out_trade_no === qqArgs.out_trade_no), 'QQ订单商户收到通知');
    // QQ账单轮询渠道也测一笔 (cookie源)
    const qqArgs2 = { ...orderArgs, type: 'qqpay', out_trade_no: 'QQBILL' + Date.now(), money: '7.07' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...qqArgs2, sign: signParams(qqArgs2, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    const qq2TradeNo = j.trade_no;
    r = await fetch(BASE + '/cashier/' + qq2TradeNo);
    const qq2Pay = ((await r.text()).match(/data-pay="([\d.]+)"/) || [])[1];
    await new Promise((resolve) => {
      const u = new URL(`http://127.0.0.1:${UPSTREAM_PORT}/setbill`);
      const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res2) => { res2.resume(); resolve(); });
      rq.end(JSON.stringify({ amount: qq2Pay, timeStr: bj(0) }));
    });
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + qq2TradeNo);
      return (await rr.json()).status >= 1;
    }, 20000);
    r = await fetch(BASE + '/api/cashier/status?trade_no=' + qq2TradeNo);
    j = await r.json();
    ok(j.status === 1, 'QQ钱包账单轮询自动确认 (免挂)');

    console.log('\n== 24. BEpusdt 加密货币渠道 (v03413 协议, mock) ==');
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'bepusdt', name: 'USDT收款', config: { url: `http://127.0.0.1:${UPSTREAM_PORT}`, auth: BE_TOKEN } }) });
    ok((await r.json()).code === 0, '创建 BEpusdt 渠道');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const beChId = channelsList.find((x) => x.plugin === 'bepusdt').id;
    ok(Number(beChId) > 0, 'BEpusdt 渠道已入库');
    // 必填校验: 缺服务地址 / 缺令牌都应被后台拦下
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'bepusdt', name: '缺参渠道', config: { url: '', auth: '' } }) });
    j = await r.json();
    ok(j.code === -1, 'BEpusdt 缺必填参数被拒');
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ alipay: apiChId, wxpay: vmq2Id, qqpay: qqBillChId, usdt: beChId }) }) });
    const beArgs = { ...orderArgs, type: 'usdt', out_trade_no: 'USDT' + Date.now(), money: '66.66' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...beArgs, sign: signParams(beArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    if (j.code !== 1) console.log('   [debug bepusdt mapi]', JSON.stringify(j));
    const beTradeNo = j.trade_no;
    ok(j.code === 1 && j.payurl.startsWith('http://127.0.0.1:' + UPSTREAM_PORT + '/pay/checkout-counter/'), 'BEpusdt 下单返回官方收银台地址');
    const beHit = bepusdtHits[0] || {};
    ok(beHit.signValid === true, 'BEpusdt 下单签名正确(body signature, 非 Authorization 头)');
    ok(beHit.order_id === beTradeNo && beHit.amount === 66.66, 'BEpusdt 订单号/金额(元) 正确');
    ok(beHit.trade_type === 'usdt.trc20' && beHit.fiat === 'CNY', 'BEpusdt 默认收款网络与法币正确');
    ok(String(beHit.notify_url).endsWith(`/channel/notify/bepusdt/${beChId}`), '回调地址指向本站并带上渠道ID');
    ok(beHit.name === '测试商品', '商品名透传上游');
    // 收银台应直接 302 到官方收银台
    r = await fetch(BASE + '/cashier/' + beTradeNo, { redirect: 'manual' });
    ok(r.status === 302 && (r.headers.get('location') || '').includes('/pay/checkout-counter/'), '收银台跳转 BEpusdt 官方收银台');
    // 错误签名回调 → 拒绝
    r = await fetch(BASE + `/channel/notify/bepusdt/${beChId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trade_id: 'BE1', order_id: beTradeNo, amount: 66.66, actual_amount: '9.25', token: 'T', block_transaction_id: 'H1', status: 2, signature: 'deadbeef' }) });
    ok((await r.text()) === 'sign error', '伪造签名的回调被拒绝');
    // 等待支付状态 (status=1) → 确认收到但不记账
    const beWait = { trade_id: 'BE1', order_id: beTradeNo, amount: 66.66, actual_amount: '9.25', token: 'T', block_transaction_id: '', status: 1 };
    beWait.signature = bepusdtSign(beWait, BE_TOKEN);
    r = await fetch(BASE + `/channel/notify/bepusdt/${beChId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(beWait) });
    ok((await r.text()) === 'success', '等待支付状态回调回 success 不重推');
    let beStatus = await (await fetch(BASE + '/api/cashier/status?trade_no=' + beTradeNo)).json();
    ok(beStatus.status === 0, '等待支付不误判为已付款');
    // 支付成功 (status=2, 空值参数不参与签名)
    const bePaid = { trade_id: 'BE1', order_id: beTradeNo, amount: 66.66, actual_amount: '9.25', token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', block_transaction_id: 'txhash123', status: 2 };
    bePaid.signature = bepusdtSign(bePaid, BE_TOKEN);
    r = await fetch(BASE + `/channel/notify/bepusdt/${beChId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bePaid) });
    ok((await r.text()) === 'success', 'BEpusdt 支付成功回调被接受');
    beStatus = await (await fetch(BASE + '/api/cashier/status?trade_no=' + beTradeNo)).json();
    ok(beStatus.status === 1, '链上确认后订单自动变为已支付');
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === beArgs.out_trade_no), 8000);
    const beNotify = merchantNotifies.find((x) => x.params.out_trade_no === beArgs.out_trade_no);
    ok(beNotify && beNotify.signValid, 'BEpusdt 订单→商户异步通知成功且签名正确');
    // 重复回调幂等
    r = await fetch(BASE + `/channel/notify/bepusdt/${beChId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bePaid) });
    ok((await r.text()) === 'success', '重复回调幂等(不重复入账)');

    console.log('\n== 25. 原生 USDT (TRC20 链上免挂对账引擎) ==');
    // 钱包地址必填校验 (空地址被拒)
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'tronusdt', name: '空地址渠道', config: { address: '' } }) });
    j = await r.json();
    ok(j.code === -1, 'TRC20钱包地址必填校验被拒');
    // 创建合法的原生 USDT 渠道
    const myWallet = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    r = await fetch(BASE + '/admin/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ plugin: 'tronusdt', name: '原生USDT', config: { address: myWallet, rate: '7.30', api_base: `http://127.0.0.1:${UPSTREAM_PORT}` } }) });
    ok((await r.json()).code === 0, '创建原生 USDT 渠道成功');
    channelsList = (await (await fetch(BASE + '/admin/api/channels', { headers: { Cookie: adminCookie } })).json()).data.list;
    const tronChId = channelsList.find((x) => x.plugin === 'tronusdt').id;
    ok(Number(tronChId) > 0, '原生 USDT 渠道已入库');
    // 映射支付类型
    await fetch(BASE + '/admin/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ channel_map: JSON.stringify({ usdt: tronChId }) }) });
    // 下单测试
    const tronArgs = { ...orderArgs, type: 'usdt', out_trade_no: 'TRONUSDT' + Date.now(), money: '100.00' };
    r = await fetch(BASE + '/mapi.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...tronArgs, sign: signParams(tronArgs, shop.key), sign_type: 'MD5' }) });
    j = await r.json();
    ok(j.code === 1, '原生 USDT 订单创建成功');
    const tronTradeNo = j.trade_no;
    ok(j.qrcode.startsWith('tron:' + myWallet + '?amount='), '返回符合标准的波场转账 URI');
    ok(j.coin_amount.includes('USDT'), '接口返回包含 USDT 货币标识');
    // 收银台页面渲染
    r = await fetch(BASE + '/cashier/' + tronTradeNo);
    const tronCashierHtml = await r.text();
    ok(tronCashierHtml.includes(myWallet), '收银台展示 TRC20 收款地址');
    ok(tronCashierHtml.includes('TRC20网络') && tronCashierHtml.includes('复制地址') && tronCashierHtml.includes('复制金额'), '收银台展示专属复制按钮与 TRC20 提示');
    // 提取订单计算的金额 (SUN)
    const expectedPayUsdt = ((tronCashierHtml.match(/data-pay="([\d.]+)"/) || [])[1]);
    const expectedPaySun = Math.round(Number(expectedPayUsdt) * 1000000);
    ok(Number(expectedPayUsdt) > 13 && Number(expectedPayUsdt) < 14, `防撞单微尾数金额正确: ${expectedPayUsdt} USDT`);
    // 尚未转账时，查询状态应为 0 (待支付)
    let tronStatus = await (await fetch(BASE + '/api/cashier/status?trade_no=' + tronTradeNo)).json();
    ok(tronStatus.status === 0, '未入账前订单保持待支付');
    // 模拟链上到账 (波场出块写入 mockTronTransfers)
    const txid = '9a8b7c6d5e4f3a2b1c0d' + Date.now();
    mockTronTransfers.push({
      transaction_id: txid,
      to: myWallet,
      value: String(expectedPaySun),
      block_timestamp: Date.now(),
    });
    // 前端收银台再次轮询状态 -> 查链命中 -> 秒级变为 1 (已支付)
    await waitFor(async () => {
      const rr = await fetch(BASE + '/api/cashier/status?trade_no=' + tronTradeNo);
      return (await rr.json()).status >= 1;
    }, 8000);
    tronStatus = await (await fetch(BASE + '/api/cashier/status?trade_no=' + tronTradeNo)).json();
    ok(tronStatus.status === 1, '波场链上出块确认后订单自动变已支付');
    // 商户异步通知
    await waitFor(async () => merchantNotifies.some((x) => x.params.out_trade_no === tronArgs.out_trade_no), 8000);
    const tronNotify = merchantNotifies.find((x) => x.params.out_trade_no === tronArgs.out_trade_no);
    ok(tronNotify && tronNotify.signValid, '原生 USDT 订单支付成功后商户收到通知');


    // 公开统计与首页
    r = await fetch(BASE + '/api/stats');
    j = await r.json();
    ok(j.code === 0 && j.data.merchants >= 3 && j.data.orders_all >= 10, '公开统计接口');
    r = await fetch(BASE + '/');
    j = await r.text();
    ok(j.includes('三网聚合') && j.includes('监控端下载') && j.includes('入驻商户') && j.includes('比同行更优质'), '首页改版(码支付风格)');

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
