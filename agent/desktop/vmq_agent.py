#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Epay Pages 跨平台监控端 (Windows / macOS / Linux)
原理: 轮询服务器待支付订单 + 监听本机"到账"事件(通知中心/支付宝账单) → 金额匹配 → 推送确认

用法:
  python3 vmq_agent.py --server https://your.site --key 你的通信密钥 [--types alipay,wxpay,qqpay] [--source notify]

数据源:
  - notify  : 监听本机系统通知/通知数据库 (Windows wpndatabase.db / macOS notification db / Linux dbus-monitor)
              需要在本机登录 微信/支付宝/QQ 桌面端并允许通知
  - bill    : 支付宝网页账单轮询 (需 --cookie, 与后台 alipaybill 渠道二选一)
仅用 Python3 标准库, 无第三方依赖。
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta

PENDING = {}  # type -> {"trade_no": str, "price": float}
AMOUNT_RE = [
    re.compile(r"([0-9]+(?:\.[0-9]{1,2})?)\s*元"),
    re.compile(r"[¥￥]\s*([0-9]+(?:\.[0-9]{1,2})?)"),
]
MONEY_WORDS = ("转账", "收款", "到账", "红包", "钱包")


def http_get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "vmq-agent/1.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return ""


def poll_task(server, key, types):
    for t in types:
        r = http_get(f"{server}/app/vmq/task?key={key}&type={t}")
        try:
            j = json.loads(r)
        except Exception:
            continue
        if j.get("code") == 1:
            PENDING[t] = {"trade_no": j["trade_no"], "price": float(j["price"])}
        else:
            PENDING.pop(t, None)


def try_push(server, key, amount, hint=""):
    for t, o in list(PENDING.items()):
        if abs(o["price"] - amount) < 0.005:
            r = http_get(f"{server}/app/vmq/push?key={key}&trade_no={o['trade_no']}&price={o['price']}")
            print(f"[push] {t} {o['trade_no']} ¥{amount:.2f} {hint} -> {r[:40]}")
            if "success" in r:
                PENDING.pop(t, None)
            return True
    return False


def amounts_from(text):
    if not any(w in text for w in MONEY_WORDS):
        return []
    out = []
    for rx in AMOUNT_RE:
        for m in rx.finditer(text):
            try:
                v = float(m.group(1))
                if 0.01 <= v <= 100000:
                    out.append(v)
            except Exception:
                pass
    return out


# ---------- Windows: 轮询系统通知数据库 wpndatabase.db ----------
def watch_windows(cb):
    dbs = glob.glob(os.path.expandvars(r"%LocalAppData%/Microsoft/Windows/Notifications/wpndatabase.db"))
    if not dbs:
        print("[warn] 未找到 wpndatabase.db, Windows 通知源不可用")
        return
    last_row = 0
    while True:
        try:
            conn = sqlite3.connect(dbs[0])
            rows = conn.execute(
                "SELECT rowid, Payload FROM Notification WHERE rowid > ? ORDER BY rowid", (last_row,)
            ).fetchall()
            conn.close()
            for rowid, payload in rows:
                last_row = max(last_row, rowid)
                text = str(payload)
                for a in amounts_from(text):
                    cb(a)
        except Exception as e:
            print("[notify-db]", e)
        time.sleep(1.5)


# ---------- macOS: 轮询通知中心 sqlite ----------
def find_mac_db():
    pats = [
        os.path.expanduser("~/Library/Group Containers/group.com.apple.usernoted/db2/db"),
        "/private/var/folders/*/*/0/com.apple.notificationcenter/db2/db",
    ]
    for p in pats:
        for f in glob.glob(p):
            return f
    return None


def watch_mac(cb):
    db = find_mac_db()
    if not db:
        print("[warn] 未找到通知中心数据库, macOS 通知源不可用(可在 系统设置-隐私 给终端完全磁盘访问)")
        return
    last = 0
    while True:
        try:
            conn = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
            rows = conn.execute("SELECT record_id, payload FROM record WHERE record_id > ?", (last,)).fetchall()
            conn.close()
            for rid, blob in rows:
                last = max(last, rid)
                text = str(blob)
                for a in amounts_from(text):
                    cb(a)
        except Exception as e:
            print("[notify-db]", e)
        time.sleep(1.5)


# ---------- Linux: dbus-monitor 系统通知 ----------
def watch_linux(cb):
    try:
        proc = subprocess.Popen(
            ["dbus-monitor", "--session", "interface='org.freedesktop.Notifications'"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
    except Exception as e:
        print("[warn] dbus-monitor 不可用:", e)
        return
    buf = []
    for line in proc.stdout:
        if "string" in line:
            buf.append(line.split("string ", 1)[-1].strip().strip('"'))
        if len(buf) >= 8:
            text = " ".join(buf)
            for a in amounts_from(text):
                cb(a)
            buf = []


# ---------- 支付宝账单轮询源 (免通知, 需 cookie) ----------
def watch_bill(server, key, cookie, bill_url, cb):
    seen = set()
    while True:
        text = http_get(bill_url)
        # 复用服务端解析格式: 表格行
        for m in re.finditer(r'class="time">([^<]+)<[\s\S]*?class="amount">[¥￥]\s*([\d.]+)<', text):
            ts, amt = m.group(1), float(m.group(2))
            bid = f"{ts}_{amt}"
            if bid in seen:
                continue
            seen.add(bid)
            print(f"[bill] 发现收入 ¥{amt:.2f} @ {ts}")
            cb(amt)
        time.sleep(10)


def main():
    ap = argparse.ArgumentParser(description="Epay Pages 跨平台监控端")
    ap.add_argument("--server", required=True, help="站点地址")
    ap.add_argument("--key", required=True, help="通信密钥")
    ap.add_argument("--types", default="alipay,wxpay,qqpay")
    ap.add_argument("--source", default="notify", choices=["notify", "bill"], help="notify=系统通知监听 / bill=支付宝账单轮询")
    ap.add_argument("--cookie", default="", help="bill 源: 支付宝网页 Cookie")
    ap.add_argument("--bill-url", default="", help="bill 源: 账单接口地址")
    args = ap.parse_args()
    server = args.server.rstrip("/")
    types = [t.strip() for t in args.types.split(",") if t.strip()]

    def cb(amount):
        try_push(server, args.key, amount)

    threading.Thread(target=lambda: _poll_loop(server, args.key, types), daemon=True).start()
    print(f"监控端已启动: {server} types={types} source={args.source}")
    if args.source == "bill":
        if not (args.cookie and args.bill_url):
            print("[error] bill 源需要 --cookie 与 --bill-url")
            sys.exit(1)
        watch_bill(server, args.key, args.cookie, args.bill_url, cb)
    elif sys.platform.startswith("win"):
        watch_windows(cb)
    elif sys.platform == "darwin":
        watch_mac(cb)
    else:
        watch_linux(cb)


def _poll_loop(server, key, types):
    while True:
        poll_task(server, key, types)
        time.sleep(1.2)


if __name__ == "__main__":
    main()
