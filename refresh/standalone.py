#!/usr/bin/env python3
"""Portfolio Ledger - daily price refresh for the standalone web app (run by GitHub Actions).

Usage: python3 refresh/standalone.py PREVIOUS_FILE OUT_FILE

Environment:
  LEDGER_REFRESH_LIST  the text the app's "Copy refresh list" button gives (which instruments
                       and benchmarks to fetch; no quantities or amounts)
  LEDGER_PASSPHRASE    the passphrase the prices file is encrypted with

PREVIOUS_FILE is the prices file from the last run (it may be missing). It carries what earlier
runs found: which Yahoo Finance symbol belongs to each instrument, logos, the benchmark catalog.
OUT_FILE receives the new encrypted prices file, which the app downloads and decrypts.

This runs refresh.py unchanged and never prints instrument names: the log of a public repository
is public. The full report travels inside the encrypted file and is shown in the app.

File format: b"PLE1", 16 bytes salt, 12 bytes nonce, then AES-256-GCM over gzip(JSON). The key
comes from the passphrase with PBKDF2-SHA256, 600000 rounds. app/local.js reads the same.
"""
import datetime, gzip, json, os, subprocess, sys, tempfile

ROUNDS = 600_000
KEEP = ("market/", "instruments/", "meta/", "requests/")


def _key(passphrase, salt):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ROUNDS).derive(passphrase.encode())


def encrypt(obj, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, nonce = os.urandom(16), os.urandom(12)
    body = gzip.compress(json.dumps(obj, separators=(",", ":")).encode())
    return b"PLE1" + salt + nonce + AESGCM(_key(passphrase, salt)).encrypt(nonce, body, None)


def decrypt(data, passphrase):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if data[:4] != b"PLE1":
        raise ValueError("not a prices file")
    return json.loads(gzip.decompress(AESGCM(_key(passphrase, data[4:20])).decrypt(data[20:32], data[32:], None)))


def main():
    prev, out = sys.argv[1:3]
    passphrase = os.environ.get("LEDGER_PASSPHRASE") or ""
    raw = os.environ.get("LEDGER_REFRESH_LIST") or ""
    if not passphrase or not raw.strip():
        sys.exit("LEDGER_PASSPHRASE and LEDGER_REFRESH_LIST must both be set (repository secrets).")
    try:
        lst = json.loads(raw)
        assert isinstance(lst, dict) and isinstance(lst.get("imports"), dict)
    except Exception:
        sys.exit("LEDGER_REFRESH_LIST isn't the text from the app's Copy refresh list button. Copy it again.")
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    state = {}
    if os.path.exists(prev) and os.path.getsize(prev):
        try:
            state = decrypt(open(prev, "rb").read(), passphrase).get("docs") or {}
            print(f"Previous prices file read: {len(state)} documents.")
        except Exception:
            print("The previous prices file couldn't be read with this passphrase. Starting fresh.")
    else:
        print("No previous prices file. Starting fresh.")

    work = tempfile.mkdtemp(prefix="ledger-")
    dump, outdir, versions = os.path.join(work, "dump"), os.path.join(work, "out"), {}

    def write(path, body, existing=True):
        coll, doc_id = path.split("/", 1)
        os.makedirs(os.path.join(dump, coll), exist_ok=True)
        with open(os.path.join(dump, coll, doc_id.replace("~", "@") + ".json"), "w") as fh:
            json.dump(body, fh)
        if existing and coll != "imports":
            versions[path] = 1

    for path, body in state.items():
        write(path, body)
    for doc_id, body in lst["imports"].items():
        write(f"imports/{doc_id}", body)
    settings = lst.get("settings") or {}
    for name in ("benchmarks", "hints"):
        if isinstance(settings.get(name), dict):
            write(f"settings/{name}", settings[name])
    if "settings/catalog" in state:
        pass  # written above: the catalog grows in the prices file
    elif isinstance(settings.get("catalog"), dict):
        write("settings/catalog", settings["catalog"])
    for doc_id, body in (lst.get("requests") or {}).items():
        if f"requests/{doc_id}" not in state:
            write(f"requests/{doc_id}", body)
    with open(os.path.join(work, "versions.json"), "w") as fh:
        json.dump(versions, fh)

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refresh.py")
    run = subprocess.run([sys.executable, "-I", script, dump, os.path.join(work, "versions.json"), outdir],
                         capture_output=True, text=True)
    result = {"v": 1, "generatedAt": now}
    if run.returncode == 0:
        n = 0
        while os.path.exists(os.path.join(outdir, f"batch-{n + 1}.json")):
            n += 1
            for w in json.load(open(os.path.join(outdir, f"batch-{n}.json"))):
                path, body = f"{w['collection']}/{w['doc_id']}", json.load(open(w["file_path"]))
                state[path] = {**state.get(path, {}), **body} if w["op"] == "update" else body
        for doc_id, body in (lst.get("requests") or {}).items():
            state.setdefault(f"requests/{doc_id}", body)
        report = open(os.path.join(outdir, "report.md")).read()
        unmatched = sorted(str(b.get("name") or b.get("saxo")) for p, b in state.items() if p.startswith("instruments/") and not b.get("yahoo"))
        if unmatched and "## NEEDS REVIEW" not in report:
            report += "\n## NEEDS REVIEW\n" + "".join(f"- {n}: no Yahoo Finance symbol found, so it has no price.\n" for n in unmatched)
        result["report"] = report
        head = next((l for l in report.splitlines() if l.startswith("Prices as of")), "Refresh finished.")
        failed = report.split("## Failed")[1].split("##")[0].count("\n- ") if "## Failed" in report else 0
        review = report.split("## NEEDS REVIEW")[1].count("\n- ") if "## NEEDS REVIEW" in report else 0
        print(head.split(";")[0] + f"; {sum(1 for p in state if p.startswith('market/'))} price series.")
        print(f"{failed} failed, {review} need review. The details are in the app (This device > Prices).")
    else:
        result["error"] = (run.stderr or run.stdout or "")[-2000:]
        print("The refresh stopped with an error. The previous prices are kept. The error text is in the "
              "encrypted file, not in this log.")
    result["docs"] = {p: b for p, b in state.items() if p.startswith(KEEP) or p == "settings/catalog"}
    data = encrypt(result, passphrase)
    with open(out, "wb") as fh:
        fh.write(data)
    print(f"Wrote the encrypted prices file: {len(data) // 1024} KB.")
    sys.exit(0 if run.returncode == 0 else 1)


if __name__ == "__main__":
    main()
