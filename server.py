#!/usr/bin/env python3
"""Local static server and Yahoo Taiwan stock quote proxy."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from urllib.request import Request, urlopen
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import re
import time

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8000"))
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8"}

def yahoo_quote(code):
    errors = []
    for suffix in ("TW", "TWO"):
        symbol = f"{code}.{suffix}"
        try:
            url = f"https://tw.stock.yahoo.com/quote/{symbol}"
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36", "Accept-Language": "zh-TW,zh;q=0.9"})
            with urlopen(request, timeout=8) as response:
                html = response.read().decode("utf-8", "replace")
            # Yahoo's quote page embeds the same current quote and market timestamp in its page data.
            price_match = re.search(r'"regularMarketPrice"\s*:\s*\{[^{}]*?"raw"\s*:\s*([0-9.]+)', html)
            time_match = re.search(r'"regularMarketTime"\s*:\s*\{[^{}]*?"raw"\s*:\s*(\d+)', html)
            if price_match:
                price = float(price_match.group(1))
                updated = datetime.fromtimestamp(int(time_match.group(1)), timezone.utc).isoformat() if time_match else datetime.now(timezone.utc).isoformat()
                return {"symbol": symbol, "price": price, "currency": "TWD", "updatedAt": updated, "source": "Yahoo 奇摩股市"}
            errors.append(f"{symbol}: 個股頁找不到報價欄位")
        except Exception as exc:
            errors.append(f"{symbol}: {exc}")
    # Yahoo's chart quote is a parsing fallback for changes to the public page markup.
    for suffix in ("TW", "TWO"):
        symbol = f"{code}.{suffix}"
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m"
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=8) as response:
                payload = json.loads(response.read())
            data = payload.get("chart", {}).get("result", [None])[0]
            meta = data.get("meta", {}) if data else {}
            price = float(meta.get("regularMarketPrice") or 0)
            if price > 0:
                timestamp = int(meta.get("regularMarketTime") or time.time())
                return {"symbol": symbol, "price": price, "currency": "TWD", "updatedAt": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(), "source": "Yahoo 奇摩股市（報價備援）"}
        except Exception as exc:
            errors.append(f"{symbol}: {exc}")
    raise RuntimeError("Yahoo 奇摩股市暫時無法提供此代號報價。")

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/quote":
            code = parse_qs(parsed.query).get("symbol", [""])[0].upper().replace(".TWO", "").replace(".TW", "")
            if not re.fullmatch(r"\d{4,6}", code):
                return self.send_json(400, {"error": "請輸入 4 至 6 位數台股代號。"})
            try:
                return self.send_json(200, yahoo_quote(code))
            except Exception as exc:
                return self.send_json(502, {"error": str(exc)})
        relative = unquote(parsed.path).lstrip("/") or "index.html"
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        try:
            data = target.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"好好理財服務已啟動，監聽 0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
