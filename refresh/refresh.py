#!/usr/bin/env python3
"""Portfolio Ledger - market-data refresh.

Usage: python3 -I refresh.py DUMP_DIR VERSIONS_JSON OUT_DIR

DUMP_DIR      ArtifactData list dumps: DUMP_DIR/<collection>/<doc_id>.json for the collections
              market, instruments, imports, requests, settings and meta.
VERSIONS_JSON {"<collection>/<doc_id>": version} for every dumped document.
OUT_DIR       receives docs/*.json, batch-1.json, batch-2.json ... (each one ArtifactData `batch`
              `writes` array, in order) and report.md.
"""
import base64, datetime, http.cookiejar, io, json, os, re, sys, time
import urllib.error, urllib.parse, urllib.request

DUMP, VERS, OUT = sys.argv[1:4]
DOCS = os.path.join(OUT, "docs")
os.makedirs(DOCS, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
NOWS = NOW.isoformat().replace("+00:00", "Z")
TODAY = NOW.date().isoformat()
versions = json.load(open(VERS)) if os.path.exists(VERS) else {}
report, review, failed = [], [], []


def load(coll):
    d, out = os.path.join(DUMP, coll), {}
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.endswith(".json"):  # the dump spells "~" in an id as "@" in its file name
                out[f[:-5].replace("@", "~")] = json.load(open(os.path.join(d, f)))
    return out


market, instruments, imports, requests, settings, meta = (
    load(c) for c in ("market", "instruments", "imports", "requests", "settings", "meta"))
EXISTING = {"market": market, "instruments": instruments, "requests": requests, "settings": settings, "meta": meta}

UA = {"User-Agent": "Mozilla/5.0"}
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(url, raw=False, tries=5):
    for i in range(tries):
        try:
            r = opener.open(urllib.request.Request(url, headers=UA), timeout=30).read()
            return r if raw else json.loads(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise


def safe_id(s):
    return re.sub(r"[^A-Za-z0-9_.\-@+:]", lambda m: "~%02X" % ord(m.group(0)), s)


# Price history starts a week before the earliest imported period (or a year ago with no imports yet).
_starts = [str(d.get("period", {}).get("from"))[:10] for d in imports.values() if (d.get("period") or {}).get("from")]
_start = min(_starts) if _starts else (NOW.date() - datetime.timedelta(days=365)).isoformat()
P1 = int(datetime.datetime.fromisoformat(_start).replace(tzinfo=datetime.timezone.utc).timestamp()) - 7 * 86400
P2 = int(time.time()) + 86400
_charts = {}


def chart(sym):
    if sym in _charts:
        return _charts[sym]
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
            f"?period1={P1}&period2={P2}&interval=1d&events=div%7Csplit")["chart"]["result"][0]
    m, ts = r["meta"], r.get("timestamp") or []
    closes = {}
    for t, v in zip(ts, (r["indicators"]["quote"][0].get("close") or [])):
        if v is not None:
            closes[datetime.datetime.fromtimestamp(t + (m.get("gmtoffset") or 0), datetime.timezone.utc).date().isoformat()] = v
    divs = sorted([datetime.datetime.fromtimestamp(ev["date"], datetime.timezone.utc).date().isoformat(), ev["amount"]]
                  for ev in ((r.get("events") or {}).get("dividends") or {}).values())
    _charts[sym] = (m, sorted(closes.items()), divs)
    time.sleep(0.6)
    return _charts[sym]


_crumb = None


def summary(sym, modules="assetProfile,price,calendarEvents,quoteType"):
    global _crumb
    if _crumb is None:
        try:
            opener.open(urllib.request.Request("https://fc.yahoo.com", headers=UA), timeout=20)
        except Exception:
            pass
        _crumb = get("https://query1.finance.yahoo.com/v1/test/getcrumb", raw=True).decode()
    u = (f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}"
         f"?modules={modules}&crumb={urllib.parse.quote(_crumb)}")
    res = get(u)["quoteSummary"]["result"][0]
    time.sleep(0.6)
    return res


def search(q):
    u = "https://query2.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode({"q": q, "quotesCount": 8, "newsCount": 0})
    return get(u).get("quotes", [])


def rv(o, k):
    v = (o or {}).get(k)
    return v.get("raw") if isinstance(v, dict) else v


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat() if ts else None


def norm(c):
    return re.sub(r"\s+", " ", str(c or "").replace(" ", " ")).strip()


# ---------- instruments seen in imports ----------
seen = {}
for doc in imports.values():
    for sname, sh in (doc.get("sheets") or {}).items():
        idx = {norm(c): i for i, c in enumerate(sh.get("columns", []))}

        def g(r, *names):
            for n in names:
                if n in idx and r[idx[n]] not in (None, ""):
                    return r[idx[n]]
            return None

        for r in sh.get("rows", []):
            s_ = g(r, "Instrumentsymbool", "Instrument symbol", "Symbol")
            if not s_:
                continue
            s = seen.setdefault(s_, {"saxo": s_})
            for key, names in (("name", ("Instrument",)), ("isin", ("Instrument ISIN", "ISIN")),
                               ("currency", ("Instrumentvaluta", "Instrument currency")), ("type", ("Type", "Asset type")),
                               ("exchange", ("Uitwisselingsbeschrijving", "Exchange description"))):
                v = g(r, *names)
                if v and not s.get(key):
                    s[key] = v
            d = g(r, "Aangepaste transactiedatum", "Trade date", "Transactiedatum")
            price = g(r, "Prijs", "Price")
            if "tradePrice" not in s and d:
                try:
                    if price is not None:
                        s["tradePrice"], s["tradeDate"] = float(price), str(d)[:10]
                    else:
                        m_ = re.match(r"^\s*\S+\s+-?[\d.]+\s*@\s*([\d.]+)", str(g(r, "Acties", "Actions") or ""))
                        if m_:
                            s["tradePrice"], s["tradeDate"] = float(m_.group(1)), str(d)[:10]
                except ValueError:
                    pass

EXCH = {"xnys": "", "xnas": "", "arcx": "", "bats": "", "xase": "", "xams": ".AS", "xcse": ".CO", "xbru": ".BR", "xpar": ".PA",
        "xetr": ".DE", "xfra": ".F", "xlon": ".L", "xmil": ".MI", "xmad": ".MC", "xswx": ".SW", "xvtx": ".SW", "xsto": ".ST",
        "xhel": ".HE", "xosl": ".OL", "xwbo": ".VI", "xlis": ".LS", "xdub": ".IR", "xtse": ".TO", "xasx": ".AX", "xhkg": ".HK"}
MONTH = dict(zip("FGHJKMNQUVXZ", range(1, 13)))


def asset_class(t):
    t = (t or "").lower()
    for pat, name in (("option", "Options"), ("future", "Futures"), ("etf|etc|etn", "ETF"), ("bond", "Bonds"),
                      ("fund", "Investment funds"), ("stock|share|equity", "Shares"), ("cfd", "CFDs")):
        if re.search(pat, t):
            return name
    return "Other"


def candidates(s):
    sym = s["saxo"]
    m = re.match(r"^([A-Za-z.]+)/(\d{2})([FGHJKMNQUVXZ])(\d{2})([CP])([\d.]+)", sym)
    if m:
        root, dd, mc, yy, cp, k = m.groups()
        occ = f"{root.upper()}{yy}{MONTH[mc]:02d}{dd}{cp}{int(round(float(k) * 1000)):08d}"
        return [occ], {"underlying": root.upper(), "strike": float(k), "expiry": f"20{yy}-{MONTH[mc]:02d}-{dd}",
                       "right": cp, "multiplier": 100}
    base, _, ex = sym.partition(":")
    out = []
    t = re.sub(r"([A-Z0-9])([a-z])$", lambda mm: mm.group(1) + "-" + mm.group(2).upper(), base).upper()
    if ex.lower() in EXCH:
        out.append(t + EXCH[ex.lower()])
    for q in (s.get("isin"), s.get("name")):
        if q:
            try:
                out += [x["symbol"] for x in search(q) if x.get("symbol")]
            except Exception:
                pass
    return list(dict.fromkeys(out)), {}


def pick(s):
    cands, extra = candidates(s)
    first = None
    for c in cands[:8]:
        try:
            _, closes, _ = chart(c)
        except Exception:
            continue
        if not closes:
            continue
        first = first or c
        if s.get("tradePrice") and s.get("tradeDate"):
            prior = [v for d, v in closes if d <= s["tradeDate"]] or [closes[0][1]]
            if abs(prior[-1] / s["tradePrice"] - 1) <= (0.25 if extra else 0.04):
                return c, extra, True
    return first, extra, False


def clean_name(n):
    n = (n or "").strip()
    return re.sub(r"(,?\s+(Inc\.?|Corporation|Corp\.?|N\.V\.|S\.A\.|A/S|plc|PLC|SE|AG|Ltd\.?|Limited))+$", "", n).strip() or n


def logo(sym):
    try:
        from PIL import Image
    except Exception:
        return None
    for t in dict.fromkeys([sym, sym.split(".")[0]]):
        try:
            b = get(f"https://financialmodelingprep.com/image-stock/{urllib.parse.quote(t)}.png", raw=True, tries=2)
            im = Image.open(io.BytesIO(b)).convert("RGBA")
            bb = im.getbbox()
            if bb:
                im = im.crop(bb)
            w, h = im.size
            side = max(w, h)
            c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            c.paste(im, ((side - w) // 2, (side - h) // 2))
            c = c.resize((64, 64), Image.LANCZOS)
            o = io.BytesIO()
            c.save(o, "PNG", optimize=True)
            return "data:image/png;base64," + base64.b64encode(o.getvalue()).decode()
        except Exception:
            continue
    return None


def calendar(sm):
    ce = sm.get("calendarEvents") or {}
    e = ce.get("earnings") or {}
    ed = [iso(x.get("raw")) for x in (e.get("earningsDate") or []) if x.get("raw")]
    cd = [iso(x.get("raw")) for x in (e.get("earningsCallDate") or []) if x.get("raw")]
    return {"earnings": ed[0] if ed else None, "earningsEstimate": bool(e.get("isEarningsDateEstimate")),
            "earningsCall": cd[0] if cd else None, "exDividend": iso(rv(ce, "exDividendDate")),
            "dividendDate": iso(rv(ce, "dividendDate")), "epsEstimate": rv(e, "earningsAverage"), "updatedAt": NOWS}


def size_class(usd):
    if not usd:
        return None
    return ("Mega cap" if usd >= 200e9 else "Large cap" if usd >= 10e9 else "Mid cap" if usd >= 2e9
            else "Small cap" if usd >= 300e6 else "Micro cap")


# ---------- new instruments ----------
inst_by_saxo = {v.get("saxo"): k for k, v in instruments.items() if v.get("saxo")}
inst_out = {k: dict(v) for k, v in instruments.items()}
for saxo, s in seen.items():
    hint = ((settings.get("hints") or {}).get("yahoo") or {}).get(saxo)  # a Yahoo symbol the user already confirmed
    if saxo in inst_by_saxo and (instruments[inst_by_saxo[saxo]].get("yahoo") or not hint):
        continue
    try:
        if hint:
            m_opt = re.match(r"^[A-Za-z.]+/\d{2}[FGHJKMNQUVXZ]\d{2}[CP][\d.]+", saxo)
            yahoo, extra, ok = hint, (candidates(s)[1] if m_opt else {}), True
        else:
            yahoo, extra, ok = pick(s)
    except Exception as e:
        yahoo, extra, ok = None, {}, False
    doc = {"saxo": saxo, "yahoo": yahoo, "name": clean_name(s.get("name")) or saxo, "ticker": saxo.split(":")[0].split("/")[0],
           "exchange": s.get("exchange"), "currency": s.get("currency"), "assetClass": asset_class(s.get("type")),
           "sector": None, "industry": None, "country": None, "logo": None, "monogram": (s.get("name") or saxo)[0].upper(),
           "addedBy": "refresh", "addedAt": NOWS}
    doc.update(extra)
    if extra:
        doc["ticker"] = yahoo
        doc["underlyingName"] = extra["underlying"]
    if yahoo:
        try:
            sm = summary(extra.get("underlying") or yahoo)
            ap, pr = sm.get("assetProfile") or {}, sm.get("price") or {}
            doc.update({"sector": ap.get("sector"), "industry": ap.get("industry"),
                        "country": {"United States": "US", "Denmark": "DK", "Netherlands": "NL", "Belgium": "BE", "France": "FR",
                                    "Germany": "DE", "United Kingdom": "GB", "Switzerland": "CH", "Luxembourg": "LU",
                                    "Ireland": "IE", "Sweden": "SE", "Italy": "IT", "Spain": "ES", "Canada": "CA",
                                    "Norway": "NO", "Finland": "FI", "Japan": "JP"}.get(ap.get("country"), ap.get("country"))})
            if not extra and pr.get("longName"):
                doc["name"] = clean_name(pr.get("longName"))
            if extra:
                doc["underlyingName"] = f"{clean_name(pr.get('longName') or extra['underlying'])} ({extra['underlying']})"
        except Exception:
            pass
        doc["logo"] = logo(extra.get("underlying") or yahoo)
    if not ok:
        review.append(f"New instrument {saxo} ({s.get('name')}): matched to {yahoo or 'nothing'}; "
                      f"{'could not verify against your trade price' if yahoo else 'no price data found'}.")
    else:
        report.append(f"Added new instrument {saxo} as {yahoo}.")
    inst_out[safe_id(saxo)] = doc

# ---------- benchmark requests ----------
cat_doc = dict(settings.get("catalog") or {"items": []})
catalog = list(cat_doc.get("items") or [])
req_updates = {}
for rid, rq in requests.items():
    if rq.get("status") not in (None, "pending"):
        continue
    q = (rq.get("query") or "").strip()
    hit = None
    try:
        for x in search(q):
            if x.get("quoteType") in ("INDEX", "ETF", "MUTUALFUND", "EQUITY", "CRYPTOCURRENCY", "FUTURE") and x.get("symbol"):
                try:
                    if chart(x["symbol"])[1]:
                        hit = x
                        break
                except Exception:
                    continue
    except Exception:
        pass
    if hit:
        if not any(c["symbol"] == hit["symbol"] for c in catalog):
            m_ = chart(hit["symbol"])[0]
            catalog.append({"symbol": hit["symbol"], "label": hit.get("shortname") or hit.get("longname") or hit["symbol"],
                            "group": "Added", "note": f"{(hit.get('quoteType') or '').title()}, {m_.get('currency') or ''}".strip(", ")})
        req_updates[rid] = {"status": "done", "symbol": hit["symbol"], "resolvedAt": NOWS}
        report.append(f"Benchmark request '{q}' added as {hit['symbol']}.")
    else:
        req_updates[rid] = {"status": "not_found", "resolvedAt": NOWS}
        review.append(f"Benchmark request '{q}': nothing suitable found on Yahoo Finance.")

# ---------- symbols to refresh ----------
syms = set()
for v in inst_out.values():
    if v.get("yahoo"):
        syms.add(v["yahoo"])
    if v.get("underlying"):
        syms.add(v["underlying"])
for c in catalog:
    syms.add(c["symbol"])
# The benchmarks on the Performance page: the saved list, or the page's DEFAULT_BENCH in a new database.
DEFAULT_BENCH = ["^STOXX", "^GSPC", "^IXIC", "IWDA.AS", "^990100-USD-STRD"]
for b in (settings.get("benchmarks") or {}).get("list") or [{"symbol": s} for s in DEFAULT_BENCH]:
    if b.get("symbol"):
        syms.add(b["symbol"])
for d in market.values():
    if d.get("symbol"):
        syms.add(d["symbol"])
syms = {s for s in syms if not s.endswith("=X")}
ccys = set()
results = {}
for s in sorted(syms):
    try:
        results[s] = chart(s)
        c = results[s][0].get("currency")
        if c and c != "EUR":
            ccys.add("GBP" if c in ("GBp", "GBX") else c)
    except Exception as e:
        failed.append(f"{s}: {e}")
for v in inst_out.values():
    if v.get("currency") and v["currency"] != "EUR":
        ccys.add("GBP" if v["currency"] in ("GBp", "GBX") else v["currency"])
ccys |= {"USD"}  # every other currency comes from the instruments and benchmarks above
for c in sorted(ccys):
    s = f"EUR{c}=X"
    try:
        results[s] = chart(s)
    except Exception as e:
        failed.append(f"{s}: {e}")

if "EURUSD=X" not in results or not results["EURUSD=X"][1]:
    raise SystemExit("Yahoo Finance did not return FX data; nothing written. " + "; ".join(failed[:5]))


def fx_to_usd(amount, ccy):
    if not amount:
        return None
    if ccy in ("GBp", "GBX"):
        amount, ccy = amount / 100, "GBP"
    eurusd = results["EURUSD=X"][1][-1][1]
    if ccy == "USD":
        return amount
    if ccy == "EUR":
        return amount * eurusd
    r = results.get(f"EUR{ccy}=X")
    return amount / r[1][-1][1] * eurusd if r and r[1] else None


# ---------- calendar + market cap for held equities ----------
for k, v in inst_out.items():
    target = v.get("underlying") or (v.get("yahoo") if v.get("assetClass") == "Shares" else None)
    if not target:
        continue
    try:
        sm = summary(target)
        pr = sm.get("price") or {}
        cap = rv(pr, "marketCap")
        v["calendar"] = calendar(sm)
        if v.get("assetClass") == "Shares" and cap:
            v["marketCap"], v["marketCapCcy"] = cap, pr.get("currency")
            v["marketCapUSD"] = fx_to_usd(cap, pr.get("currency"))
            v["sizeClass"] = size_class(v["marketCapUSD"])
    except Exception as e:
        failed.append(f"profile {target}: {e}")

# ---------- write docs ----------
writes = []


def put(coll, doc_id, body, op="set"):
    path = os.path.join(DOCS, f"{coll}__{doc_id}.json")
    with open(path, "w") as fh:
        json.dump(body, fh)
    e = {"op": op, "collection": coll, "doc_id": doc_id, "file_path": os.path.abspath(path)}
    v = versions.get(f"{coll}/{doc_id}")
    if v:
        e["if_version"] = int(v)
    elif doc_id in EXISTING.get(coll, {}):
        raise SystemExit(f"Missing version for existing document {coll}/{doc_id}; add it to {VERS} and run again.")
    writes.append((e, os.path.getsize(path)))


labels = {c["symbol"]: c["label"] for c in catalog}
for s, (m, closes, divs) in sorted(results.items()):
    if not closes:
        failed.append(f"{s}: no closes")
        continue
    dec = 6 if s.endswith("=X") else 4
    prev = market.get(safe_id(s), {})
    ccy = m.get("currency") or prev.get("currency") or ("USD" if "USD" in s else "EUR")
    put("market", safe_id(s), {"symbol": s, "name": labels.get(s) or prev.get("name") or m.get("longName") or m.get("shortName") or s,
                              "longName": m.get("longName") or m.get("shortName"), "currency": ccy, "type": m.get("instrumentType"),
                              "exchange": m.get("fullExchangeName"), "price": m.get("regularMarketPrice"),
                              "priceTime": m.get("regularMarketTime"), "high52": m.get("fiftyTwoWeekHigh"),
                              "low52": m.get("fiftyTwoWeekLow"), "closes": [[d, round(v, dec)] for d, v in closes],
                              "divs": divs, "source": "Yahoo Finance", "updatedAt": NOWS})
for k, v in sorted(inst_out.items()):
    v["edit"] = {"via": "claude", "at": NOWS}
    put("instruments", k, v)
if catalog != (settings.get("catalog") or {}).get("items"):
    cat_doc["items"] = catalog
    cat_doc["edit"] = {"via": "claude", "at": NOWS}
    put("settings", "catalog", cat_doc)
for rid, upd in req_updates.items():
    put("requests", rid, upd, op="update")
as_of = results["EURUSD=X"][1][-1][0]
put("meta", "refresh", {"pricesAsOf": as_of, "fetchedAt": NOWS, "source": "Yahoo Finance (daily closes)", "by": "daily refresh",
                        "symbols": len(results), "failed": failed[:20]})

# ---------- batches (<= 45 writes, <= 900 KB each) ----------
batches, cur, size = [], [], 0
for e, sz in writes:
    if cur and (len(cur) >= 45 or size + sz > 900_000):
        batches.append(cur)
        cur, size = [], 0
    cur.append(e)
    size += sz
if cur:
    batches.append(cur)
for i, b in enumerate(batches, 1):
    with open(os.path.join(OUT, f"batch-{i}.json"), "w") as fh:
        json.dump(b, fh)

with open(os.path.join(OUT, "report.md"), "w") as fh:
    fh.write(f"# Refresh {NOWS}\n\nPrices as of {as_of}; {len(results)} symbols fetched; {len(writes)} writes in {len(batches)} batch(es).\n\n")
    for line in report:
        fh.write(f"- {line}\n")
    if failed:
        fh.write("\n## Failed\n" + "".join(f"- {f}\n" for f in failed))
    if review:
        fh.write("\n## NEEDS REVIEW\n" + "".join(f"- {r}\n" for r in review))
print(open(os.path.join(OUT, "report.md")).read())
