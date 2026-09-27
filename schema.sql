-- Epay Pages D1 schema (money 单位: 分, 时间: unix 秒)
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS users (
  uid INTEGER PRIMARY KEY AUTOINCREMENT,
  gid INTEGER DEFAULT 1,
  username TEXT UNIQUE NOT NULL,
  email TEXT DEFAULT '',
  password TEXT NOT NULL,            -- pbkdf2$iter$salt$hash
  key TEXT NOT NULL,                 -- 商户密钥
  money INTEGER DEFAULT 0,           -- 余额(分)
  mode INTEGER DEFAULT 1,            -- 1=余额结算
  status INTEGER DEFAULT 1,          -- 1正常 0禁用
  regtime INTEGER
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin TEXT NOT NULL,              -- epay/vmq/bepusdt/xorpay
  name TEXT NOT NULL,
  status INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  types TEXT DEFAULT '[]'            -- 支持的支付方式 json
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_no TEXT UNIQUE NOT NULL,
  out_trade_no TEXT,
  uid INTEGER NOT NULL,
  type TEXT NOT NULL,                -- alipay/wxpay/qqpay/usdt
  channel INTEGER,
  name TEXT,
  money INTEGER NOT NULL,            -- 订单金额(分)
  realmoney INTEGER DEFAULT 0,       -- 实付(分)
  status INTEGER DEFAULT 0,          -- 0待支付 1已支付 2已退款 3已完成
  addtime INTEGER,
  endtime INTEGER,
  notify_url TEXT DEFAULT '',
  return_url TEXT DEFAULT '',
  domain TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  api_trade_no TEXT DEFAULT '',      -- 上游单号
  notify_count INTEGER DEFAULT 0,
  notify_status INTEGER DEFAULT 0,   -- 商户通知 0未成功 1成功
  ext TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_orders_uid ON orders(uid);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_out ON orders(uid, out_trade_no);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid INTEGER NOT NULL,
  type INTEGER NOT NULL,             -- 1收入 2退款 3结算 4调整
  money INTEGER NOT NULL,
  addtime INTEGER,
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  addtime INTEGER,
  status INTEGER DEFAULT 0,          -- 0待处理 1已打款 2驳回
  note TEXT DEFAULT ''
);
