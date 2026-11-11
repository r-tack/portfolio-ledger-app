#!/usr/bin/env python3
"""Build the standalone web app.

Usage: python3 app/build.py OUT_DIR

Writes OUT_DIR/index.html (portfolio-ledger.html inside a complete HTML document, with app/local.js
loaded first) and copies the other files in app/ next to it. Host OUT_DIR on any static web
server with https. The GitHub Actions workflow does this for GitHub Pages.
"""
import os, shutil, sys

here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
page = open(os.path.join(here, "..", "portfolio-ledger.html"), encoding="utf-8").read()
head = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Ledger">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151a22" media="(prefers-color-scheme: dark)">
<style>:root{color-scheme:light dark;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0}img{max-width:100%}</style>
<script src="local.js"></script>
</head><body>
"""
tail = """
<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>
</body></html>
"""
with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as fh:
    fh.write(head + page + tail)
for f in sorted(os.listdir(here)):
    if f.endswith((".js", ".webmanifest", ".png")):
        shutil.copy(os.path.join(here, f), os.path.join(out, f))
print("built", out)
