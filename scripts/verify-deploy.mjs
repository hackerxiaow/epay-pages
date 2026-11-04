#!/usr/bin/env node
/**
 * 部署后验证：站点可用性 + 存储连通 + 部署地域 + 云函数单请求时长阶梯实测。
 *
 * 用法：
 *   node scripts/verify-deploy.mjs [--base=https://epay-pages-20q0y8fd.edgeone.dev]
 *                                 [--admin-user=admin] [--admin-pass=xxx] [--full]
 *
 *   --base       目标站点（默认 EdgeOne 海外生产域名）
 *   --admin-user 管理员账号（也可用环境变量 ADMIN_USERNAME）
 *   --admin-pass 管理员密码（也可用环境变量 ADMIN_PASSWORD）
 *   --full       额外探测 125s（预期失败，用于确认 120s 就是平台硬上限）
 *
 * 阶梯实测的原理：/admin/api/selftest/delay?ms=N 会睡 N 毫秒并回吐真实耗时，
 * 逐级加压直到请求被平台掐断，就能确认「单次请求超时」到底是多少。
 */
// 大陆网络直连 EdgeOne 预置域名 *.edgeone.dev 会返回 401，
// 需要挂代理才能验证线上：HTTPS_PROXY=http://127.0.0.1:10808 node scripts/verify-deploy.mjs
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(PROXY));
  console.log(`（已启用代理: ${PROXY}）`);
}

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};
const FULL = args.includes('--full');
const BASE = getArg('base', 'https://epay-pages-20q0y8fd.edgeone.dev').replace(/\/$/, '');
const USER = getArg('admin-user', process.env.ADMIN_USERNAME || '');
const PASS = getArg('admin-pass', process.env.ADMIN_PASSWORD || '');

let pass = 0;
let fail = 0;
const ok = (name, extra = '') => {
  pass++;
  console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`);
};
const ng = (name, extra = '') => {
  fail++;
  console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`);
};
const chk = (name, cond, extra = '') => (cond ? ok(name, extra) : ng(name, extra));

async function req(path, opt = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, { ...opt, signal: ctrl.signal, redirect: 'manual' });
    const body = await r.text();
    return { status: r.status, body, headers: r.headers };
  } catch (e) {
    return { status: 0, body: String(e.message || e), headers: new Headers() };
  } finally {
    clearTimeout(t);
  }
}

console.log(`\n===== 部署后验证: ${BASE} =====\n`);

/* ── 1. 站点与存储 ── */
console.log('— 站点与存储 —');
let r = await req('/');
chk('首页 200', r.status === 200, `HTTP ${r.status}`);
chk('首页含站点名', r.body.includes('Epay Pages'));

r = await req(`/api/health?t=${Date.now()}`);
let health = {};
try {
  health = JSON.parse(r.body);
} catch {}
chk('健康检查 200', r.status === 200, `HTTP ${r.status}`);
chk('存储为 EdgeOne Blob', health.store === 'edgeone', `store=${health.store}`);
chk('已初始化', health.initialized === true, `initialized=${health.initialized}`);
chk('构建标识非空', !!health.build, `build=${health.build}`);
chk(
  '部署地域为香港',
  String(health.region || '').includes('hongkong'),
  `region=${health.region || '(未上报)'}`
);

for (const p of ['/doc', '/admin.html', '/user.html', '/api/stats']) {
  r = await req(`${p}${p.includes('?') ? '&' : '?'}t=${Date.now()}`);
  chk(`${p} 200`, r.status === 200, `HTTP ${r.status}`);
}

/* ── 2. 登录与后台 ── */
console.log('\n— 登录与后台 —');
let cookie = '';
if (!USER || !PASS) {
  console.log('  ⚠️ 未提供管理员账号密码，跳过后台与时长实测（--admin-user / --admin-pass）');
} else {
  r = await req(`/admin/api/login?t=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  chk('管理员登录', (() => { try { return JSON.parse(r.body).code === 0; } catch { return false; } })(), r.body.slice(0, 60));
  const jar = [];
  for (const line of r.headers.getSetCookie ? r.headers.getSetCookie() : []) jar.push(line.split(';')[0]);
  cookie = jar.join('; ');
  const auth = { headers: { Cookie: cookie } };

  r = await req(`/admin/api/info?t=${Date.now()}`, auth);
  chk('后台概览接口', (() => { try { return JSON.parse(r.body).code === 0; } catch { return false; } })());
  r = await req(`/admin/api/channels?t=${Date.now()}`, auth);
  chk('渠道列表接口', (() => { try { return JSON.parse(r.body).code === 0; } catch { return false; } })());
  r = await req(`/admin/api/groups?t=${Date.now()}`, auth);
  chk('默认分组存在(id=1)', (() => {
    try {
      const list = JSON.parse(r.body).data;
      return list.some((g) => g.id === 1 && g.rate === 0);
    } catch { return false; }
  })());

  /* ── 3. 云函数单请求时长阶梯实测（maxDuration: 120s） ── */
  console.log('\n— 云函数单请求时长实测 —');
  const probe = await req(`/admin/api/selftest/delay?ms=10`, auth, 15000);
  if (probe.status !== 200) {
    console.log('  ⚠️ 延时探针不可用，跳过时长实测');
  } else {
    const ladder = FULL ? [1000, 30000, 65000, 110000, 120000, 125000] : [1000, 30000, 65000, 110000, 120000];
    let maxOk = 0;
    for (const ms of ladder) {
      const s = Date.now();
      const res = await req(`/admin/api/selftest/delay?ms=${ms}`, auth, ms + 40000);
      const wall = Date.now() - s;
      let actual = -1;
      try {
        actual = JSON.parse(res.body).data.actualMs;
      } catch {}
      const good = res.status === 200 && actual >= ms * 0.9;
      if (good) maxOk = Math.max(maxOk, ms);
      console.log(
        `  ${good ? '✅' : '❌'} 请求 ${String(Math.round(ms / 1000)).padStart(3)}s → HTTP ${res.status}` +
          ` 实际等待 ${(actual / 1000).toFixed(1)}s (墙钟 ${(wall / 1000).toFixed(1)}s)` +
          `${res.status !== 200 ? ' ' + res.body.slice(0, 60).replace(/\s+/g, ' ') : ''}`
      );
    }
    console.log(`\n  ⏱  单请求实测最长成功: ${(maxOk / 1000).toFixed(0)}s`);
    chk('单请求超时达到 120s', maxOk >= 120000, `最长成功 ${(maxOk / 1000).toFixed(0)}s`);
    if (FULL) {
      console.log('  ℹ️ 125s 预期失败（超出平台 120s 硬上限），失败即说明上限生效');
    }
  }
}

console.log(`\n===== 结果: 通过 ${pass} 失败 ${fail} =====\n`);
process.exit(fail ? 1 : 0);
