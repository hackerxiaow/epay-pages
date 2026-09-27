-- Epay Pages 增量迁移 (v2): RSA/分组/邀请/风控/实名
ALTER TABLE users ADD COLUMN keytype INTEGER DEFAULT 0;        -- 0=MD5 1=RSA
ALTER TABLE users ADD COLUMN publickey TEXT DEFAULT '';        -- 商户RSA公钥(PEM)
ALTER TABLE users ADD COLUMN domain TEXT DEFAULT '';           -- 域名白名单(逗号分隔)
ALTER TABLE users ADD COLUMN invite_uid INTEGER DEFAULT 0;     -- 邀请人
ALTER TABLE users ADD COLUMN cert INTEGER DEFAULT 0;           -- 0未认证 1待审 2已认证
ALTER TABLE users ADD COLUMN cert_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN cert_no TEXT DEFAULT '';

ALTER TABLE channels ADD COLUMN weight INTEGER DEFAULT 1;      -- 轮询权重

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rate REAL DEFAULT 0                                          -- 平台费率 %
);
INSERT INTO groups (id, name, rate) SELECT 1, '默认分组', 0 WHERE NOT EXISTS (SELECT 1 FROM groups WHERE id=1);

CREATE TABLE IF NOT EXISTS regcodes (
  k TEXT PRIMARY KEY,                                          -- email:xxx 或 cap:xxx
  v TEXT NOT NULL,
  time INTEGER
);
