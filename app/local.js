/* Portfolio Ledger as a standalone web app (no claude.ai).
   This file gives the page what claude.ai gives the artifact: a database. Here it lives on this
   device only, in the browser's IndexedDB. It also downloads the encrypted prices file that the
   daily GitHub Actions job publishes next to the app, and adds a "This device" panel to the
   Transactions page: prices passphrase, refresh list, backup and restore.
   The page (portfolio-ledger.html) finds all of this through window.claude and window.Standalone. */
(() => {
  'use strict';
  const PRICES_URL = 'prices.json.enc', BACKUP_FORMAT = 'portfolio-ledger-backup';
  const ls = {
    get(k, f) { try { const v = localStorage.getItem('pl:' + k); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('pl:' + k); else localStorage.setItem('pl:' + k, JSON.stringify(v)); } catch {} },
  };
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

  /* ---------- the database: every document in memory, mirrored to IndexedDB ---------- */
  const DOCS = new Map(), docL = new Map(), colL = new Map();
  let idb = null;
  const ready = new Promise((res, rej) => {
    let rq; try { rq = indexedDB.open('portfolio-ledger', 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('docs');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => {
      idb = rq.result;
      const cur = idb.transaction('docs').objectStore('docs').openCursor();
      cur.onerror = () => rej(cur.error);
      cur.onsuccess = () => { const c = cur.result; if (c) { DOCS.set(c.key, c.value); c.continue(); } else res(); };
    };
  });
  /* One transaction: `sets` is {path: document}, `dels` a list of paths. */
  function commit(sets, dels) {
    return new Promise((res, rej) => {
      const t = idb.transaction('docs', 'readwrite'), st = t.objectStore('docs');
      for (const [p, d] of Object.entries(sets || {})) st.put(d, p);
      for (const p of dels || []) st.delete(p);
      t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error || new Error('The data could not be saved on this device.'));
    }).then(() => {
      const touched = new Set();
      for (const [p, d] of Object.entries(sets || {})) { DOCS.set(p, d); touched.add(p); }
      for (const p of dels || []) { DOCS.delete(p); touched.add(p); }
      notify(touched);
    });
  }
  const snapDoc = p => ({ id: p.split('/').pop(), exists: DOCS.has(p), data: () => clone(DOCS.get(p)), metadata: { fromCache: false, hasPendingWrites: false } });
  const snapCol = c => { const docs = [...DOCS.keys()].filter(k => k.split('/').length === 2 && k.split('/')[0] === c).sort().map(snapDoc); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } }; };
  function notify(paths) {
    setTimeout(() => {
      const cols = new Set();
      for (const p of paths) { cols.add(p.split('/')[0]); (docL.get(p) || []).forEach(f => f(snapDoc(p))); }
      for (const c of cols) (colL.get(c) || []).forEach(f => f(snapCol(c)));
    }, 0);
  }
  const listen = (map, k, fn, snap) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(fn); setTimeout(() => fn(snap()), 0); return () => map.get(k).delete(fn); };
  const doc = p => ({
    id: p.split('/').pop(), path: p,
    onSnapshot: fn => listen(docL, p, fn, () => snapDoc(p)),
    get: async () => snapDoc(p),
    set: d => commit({ [p]: clone(d) }),
    update: d => commit({ [p]: Object.assign({}, DOCS.get(p), clone(d)) }),
    delete: () => commit(null, [p]),
  });
  const db = {
    doc,
    collection: c => ({
      doc: id => doc(c + '/' + id),
      onSnapshot: fn => listen(colL, c, fn, () => snapCol(c)),
      add: async d => { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); await commit({ [c + '/' + id]: clone(d) }); return { id }; },
    }),
  };
  window.claude = {
    use: async name => {
      if (name === 'db') { try { await ready; return db; } catch { return null; } }
      if (name === 'user') return { can: async () => true, isOwner: async () => false };
      return null;
    },
  };

  /* ---------- the encrypted prices file ----------
     Bytes: "PLE1", 16 bytes salt, 12 bytes nonce, then AES-256-GCM over gzip(JSON). The key comes
     from the passphrase with PBKDF2-SHA256, 600000 rounds. refresh/standalone.py writes the same. */
  async function decrypt(buf, pass) {
    const u = new Uint8Array(buf);
    if (u.length < 48 || String.fromCharCode(...u.slice(0, 4)) !== 'PLE1') throw { code: 'format' };
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: u.slice(4, 20), iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain; try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(20, 32) }, key, u.slice(32)); } catch { throw { code: 'passphrase' }; }
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  let ctx = null, checking = null;
  const state = () => ls.get('prices', {});
  /* Only a real change redraws the page; a check that finds nothing new just notes the time. */
  const setState = s => { const old = state(), strip = x => JSON.stringify(Object.assign({}, x, { checkedAt: 0 })); ls.set('prices', s); if (ctx && strip(old) !== strip(s)) ctx.scheduleRender(); };
  function checkPrices() {
    return checking = checking || (async () => {
      const pass = ls.get('pass', '');
      const keep = state(), at = new Date().toISOString();
      try {
        await ready;
        if (!pass) { setState(Object.assign({}, keep, { status: 'nopass', checkedAt: at })); return; }
        let r; try { r = await fetch(PRICES_URL, { cache: 'no-store' }); } catch { setState(Object.assign({}, keep, { status: 'offline', checkedAt: at })); return; }
        if (r.status === 404) { setState(Object.assign({}, keep, { status: 'nofile', checkedAt: at })); return; }
        if (!r.ok) { setState(Object.assign({}, keep, { status: 'offline', checkedAt: at })); return; }
        const buf = await r.arrayBuffer(), fileId = btoa(String.fromCharCode(...new Uint8Array(buf).slice(4, 32)));
        if (keep.status === 'ok' && keep.fileId === fileId) { setState(Object.assign({}, keep, { checkedAt: at })); return; }  // same file as last time: nothing to do
        const file = await decrypt(buf, pass);
        const docs = file.docs || {}, sets = {};
        for (const [p, d] of Object.entries(docs)) {
          if (/^(market|instruments|meta)\/[^/]+$/.test(p) || p === 'settings/catalog') sets[p] = d;
          else if (/^requests\/[^/]+$/.test(p) && DOCS.has(p)) sets[p] = Object.assign({}, DOCS.get(p), d);
        }
        if (file.generatedAt !== keep.applied) await commit(sets);
        setState({ status: 'ok', checkedAt: at, fileId, applied: file.generatedAt, report: file.report || '', error: file.error || '' });
      } catch (e) {
        setState(Object.assign({}, keep, { status: e && e.code === 'passphrase' ? 'badpass' : e && e.code === 'format' ? 'format' : 'error', checkedAt: at }));
      }
    })().then(maybeStartJob).finally(() => { checking = null; });
  }

  /* ---------- starting the daily job from the app ----------
     GitHub's own timer can start the job hours late, or not at all. So when the app finds no
     prices from the latest 6:53 run, it asks GitHub to run the job now (the workflow's "Run
     workflow" button, through the API). That needs a fine-grained GitHub token that may only run
     Actions on this one repository, saved on this device. At most one start per 20 minutes. */
  const JOB = 'refresh.yml', DUE = { tz: 'Europe/Brussels', h: 6, m: 53 }, JOB_WAIT = 20 * 60e3;
  // The app's repository, from its GitHub Pages address: https://<owner>.github.io/<repository>/
  const repo = () => { const m = location.hostname.match(/^([A-Za-z0-9-]+)\.github\.io$/), seg = location.pathname.split('/')[1]; return m && seg ? `${m[1]}/${seg}` : ls.get('repo', ''); };
  // The latest 6:53 in Belgium that has already passed, as a UTC time in ms.
  function lastDue(now = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: DUE.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(now)).map(x => [x.type, +x.value]));
    const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second), offset = local - Math.floor(now / 1000) * 1000;
    let due = Date.UTC(parts.year, parts.month - 1, parts.day, DUE.h, DUE.m) - offset;
    if (due > now) due -= 864e5;
    return due;
  }
  const job = () => ls.get('job', {});
  async function maybeStartJob() {
    const s = state(), token = ls.get('ghtoken', ''), r = repo();
    if (!token || !r || !['ok', 'nofile'].includes(s.status)) return;
    if (s.status === 'ok' && Date.parse(s.applied) >= lastDue()) return;  // today's prices are here
    if (Date.now() - (job().at || 0) < JOB_WAIT) return;                  // started a moment ago
    const j = { at: Date.now() };
    ls.set('job', j);
    try {
      const res = await fetch(`https://api.github.com/repos/${r}/actions/workflows/${JOB}/dispatches`, {
        method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ ref: 'main' }) });
      j.result = res.status === 204 ? 'started' : res.status === 401 ? 'badtoken' : res.status === 403 || res.status === 404 ? 'noaccess' : 'error';
    } catch { j.result = 'error'; }
    ls.set('job', j);
    if (j.result === 'started') { ctx.S.refreshStarted = j.at; follow(); }
    ctx.scheduleRender();
  }
  // After a start: look for the new file every 30 seconds for 15 minutes.
  let following = null;
  function follow() {
    clearInterval(following);
    const until = job().at + 15 * 60e3;
    following = setInterval(() => { if (Date.now() > until || (state().status === 'ok' && Date.parse(state().applied) >= job().at - 60e3)) { clearInterval(following); ctx.scheduleRender(); return; } checkPrices(); }, 30e3);
  }
  function jobLine() {
    const j = job(), r = repo();
    if (!ls.get('ghtoken', '')) return 'To get prices even when GitHub starts the 6:53 job late, save a GitHub token here: the app then starts the job itself when it opens.';
    if (!r) return "The app couldn't tell its GitHub repository from its address.";
    switch (j.result) {
      case 'started': return `Token saved. The app started the job ${when(new Date(j.at).toISOString())}${Date.now() - j.at < 15 * 60e3 ? ': new prices in a couple of minutes.' : '.'}`;
      case 'badtoken': return 'GitHub refused the token (expired or mistyped). Create a new one and save it.';
      case 'noaccess': return `The token may not run Actions on ${r}. It needs access to this repository with "Actions: Read and write".`;
      case 'error': return "The job couldn't be started (offline?). The app tries again later.";
      default: return 'Token saved. The app starts the job itself when the prices from 6:53 are missing.';
    }
  }

  /* ---------- the refresh list: what the daily job needs to know, and nothing more ----------
     One line per instrument (symbol, name, ISIN, currency, type, exchange, and the date and price
     of one trade, used to check that the right Yahoo Finance symbol was found), the benchmarks,
     and open benchmark requests. No quantities, amounts or cash. It goes into a GitHub secret. */
  function refreshList() {
    const S = ctx.S, m = ctx.getModel(), by = new Map(); let from = null;
    for (const e of m.allEvents) {
      if (e.date && (!from || e.date < from)) from = e.date;
      if (!e.symbol) continue;
      const r = by.get(e.symbol) || { s: e.symbol }; by.set(e.symbol, r);
      for (const [k, v] of [['name', e.instrument], ['isin', e.isin], ['ccy', e.iccy], ['type', e.type], ['exch', e.exchange]]) if (v && !r[k]) r[k] = v;
      if (r.price == null && e.price != null && e.date && (e.kind === 'buy' || e.kind === 'sell')) { r.price = e.price; r.date = e.date; }
    }
    const rows = [...by.values()].sort((a, b) => a.s.localeCompare(b.s)).map(r => [r.s, r.name || null, r.isin || null, r.ccy || null, r.type || null, r.exch || null, r.date || null, r.price == null ? null : r.price]);
    const hints = {}; for (const r of by.values()) { const i = S.instruments[r.s]; if (i && i.yahoo) hints[r.s] = i.yahoo; }
    const requests = {}; for (const q of S.requests) if (!q.status || q.status === 'pending') requests[q.__id] = { kind: q.kind, query: q.query, at: q.at, status: 'pending' };
    const settings = { hints: { yahoo: hints } };
    if (S.bench) settings.benchmarks = S.bench;
    if (S.catalog && S.catalog.length) settings.catalog = { items: S.catalog };
    return {
      v: 1,
      imports: { list: { period: from ? { from } : null, sheets: { Instruments: { columns: ['Instrumentsymbool', 'Instrument', 'Instrument ISIN', 'Instrumentvaluta', 'Type', 'Uitwisselingsbeschrijving', 'Trade date', 'Prijs'], rows } } } },
      settings, requests,
    };
  }
  /* What the job would fetch: instruments, benchmarks and open requests. A changed Yahoo symbol
     found by the job itself doesn't count as a change. */
  const listKey = l => JSON.stringify([l.imports.list.sheets.Instruments.rows.map(r => r[0]), (l.settings.benchmarks && l.settings.benchmarks.list || []).map(b => b.symbol), Object.keys(l.requests)]);

  /* ---------- backup and restore ---------- */
  function backup() {
    const docs = {}; for (const [p, d] of DOCS) docs[p] = d;
    const blob = new Blob([JSON.stringify({ format: BACKUP_FORMAT, v: 1, exportedAt: new Date().toISOString(), docs })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `portfolio-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  async function restore(file) {
    let b; try { b = JSON.parse(await file.text()); } catch { throw new Error("That file isn't a Portfolio Ledger backup."); }
    if (!b || b.format !== BACKUP_FORMAT || !b.docs || typeof b.docs !== 'object') throw new Error("That file isn't a Portfolio Ledger backup.");
    const sets = {}; for (const [p, d] of Object.entries(b.docs)) if (/^[^/]+\/[^/]+$/.test(p) && d && typeof d === 'object') sets[p] = d;
    await commit(sets, [...DOCS.keys()].filter(p => !(p in sets)));
    ls.set('prices', Object.assign({}, state(), { applied: null, fileId: null }));
    return Object.keys(sets).length;
  }

  /* ---------- the "This device" panel on the Transactions page ---------- */
  const when = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  function pricesLine() {
    const s = state(), meta = ctx.S.meta;
    const asOf = meta && meta.pricesAsOf ? ` Prices as of ${meta.pricesAsOf}.` : '';
    switch (s.status) {
      case 'ok': return `Updated automatically. Last daily refresh: ${when(s.applied)}.${asOf}${s.error ? ' The last daily refresh failed, so these are the prices from the run before it.' : ''}`;
      case 'nopass': return 'Enter the prices passphrase to download prices on this device.';
      case 'badpass': return "The passphrase doesn't match the prices file. Check it and save it again.";
      case 'nofile': return 'No prices file has been published yet. It appears after the first daily refresh.';
      case 'offline': return `The prices file couldn't be downloaded (offline?).${asOf}`;
      case 'format': case 'error': return `The prices file couldn't be read.${asOf}`;
      default: return 'Checking for prices…';
    }
  }
  function panelHTML() {
    if (!ctx) return '';
    const esc = ctx.esc, s = state(), has = !!ls.get('pass', '');
    let changed = false, count = 0;
    try { const l = refreshList(); count = l.imports.list.sheets.Instruments.rows.length; changed = count > 0 && listKey(l) !== ls.get('listKey', ''); } catch {}
    const review = (s.report || '').split('## NEEDS REVIEW')[1];
    return `<section class="panel" id="sa-panel">
      <div class="panel-head"><h2>This device</h2><span class="small muted">Your data is stored only on this device</span></div>
      <div style="display:grid;gap:16px">
        <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:10px">
          <div><h3 class="sub-h" style="margin:0">Prices</h3><p class="small ink2" id="sa-prices" role="status" style="margin:2px 0 0">${esc(pricesLine())}</p></div>
          <div class="manage-add"><input type="password" id="sa-pass" autocomplete="off" style="border:1px solid var(--line-2);background:var(--surface);border-radius:9px;padding:7px 11px;font-size:13.5px" placeholder="${has ? 'Passphrase saved. Type a new one to change it' : 'Prices passphrase'}" aria-label="Prices passphrase"><button class="btn" id="sa-pass-save">Save passphrase</button></div>
          <p class="small muted" id="sa-job" style="margin:0">${esc(jobLine())}</p>
          <div class="manage-add"><input type="password" id="sa-token" autocomplete="off" style="border:1px solid var(--line-2);background:var(--surface);border-radius:9px;padding:7px 11px;font-size:13.5px" placeholder="${ls.get('ghtoken', '') ? 'GitHub token saved. Paste a new one to change it' : 'GitHub token (github_pat_…)'}" aria-label="GitHub token"><button class="btn" id="sa-token-save">Save token</button></div>
          ${review ? `<details class="small"><summary>The daily refresh has notes for you</summary><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(review.trim())}</pre></details>` : ''}
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:10px">
          <div><h3 class="sub-h" style="margin:0">Refresh list ${changed ? '<span class="pill warn">changed since you last copied it</span>' : ''}</h3>
          <p class="small muted" style="margin:2px 0 0">The daily refresh fetches prices for the instruments on this list (${count} now). It holds symbols and one trade price each, no quantities or amounts. Copy it into the GitHub secret LEDGER_REFRESH_LIST after your first import, and again when you buy something new or change a benchmark.</p></div>
          <div class="manage-add"><button class="btn" id="sa-copy" ${count ? '' : 'disabled'}>Copy refresh list</button></div>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:10px">
          <div><h3 class="sub-h" style="margin:0">Backup</h3><p class="small muted" style="margin:2px 0 0">A backup file holds everything on this device: imports, edits, settings and prices. Restore it on another device to copy your portfolio there. Restoring replaces what that device holds.</p></div>
          <div class="manage-add"><button class="btn" id="sa-backup">Download backup</button><button class="btn" id="sa-restore">Restore backup…</button><input type="file" id="sa-restore-file" accept=".json,application/json" hidden></div>
        </div>
      </div></section>`;
  }
  function bind(v) {
    if (!ctx) return;
    const $ = s => v.querySelector(s), toast = ctx.toast;
    if (!$('#sa-panel')) return;
    $('#sa-pass-save').onclick = async () => {
      const p = $('#sa-pass').value; if (!p) { toast('Type the passphrase first.'); return; }
      ls.set('pass', p); ls.set('prices', Object.assign({}, state(), { applied: null, fileId: null })); toast('Passphrase saved on this device. Checking prices…');
      await checkPrices(); toast(state().status === 'ok' ? 'Prices downloaded.' : pricesLine());
    };
    $('#sa-token-save').onclick = async () => {
      const t = $('#sa-token').value.trim(); if (!t) { toast('Paste the token first.'); return; }
      ls.set('ghtoken', t); ls.set('job', {}); toast('Token saved on this device.'); ctx.scheduleRender();
      await checkPrices(); if (job().result) toast(jobLine());
    };
    $('#sa-copy').onclick = async () => {
      const l = refreshList(), text = JSON.stringify(l);
      try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copy this text:', text); }
      ls.set('listKey', listKey(l)); toast('Refresh list copied. Paste it into the GitHub secret LEDGER_REFRESH_LIST.'); ctx.scheduleRender();
    };
    $('#sa-backup').onclick = () => { backup(); toast('Backup downloaded. It holds your whole portfolio: keep it private.'); };
    const rb = $('#sa-restore'), rf = $('#sa-restore-file');
    rb.onclick = () => {
      if (DOCS.size && rb.dataset.confirm !== '1') { rb.dataset.confirm = '1'; rb.textContent = 'Click again: replaces the data on this device'; setTimeout(() => { if (rb.isConnected) { rb.dataset.confirm = ''; rb.textContent = 'Restore backup…'; } }, 5000); return; }
      rf.click();
    };
    rf.onchange = async () => { const f = rf.files[0]; rf.value = ''; if (!f) return; try { const n = await restore(f); toast(`Backup restored: ${n} documents.`); checkPrices(); } catch (e) { toast(e.message || "The backup couldn't be restored."); } };
  }

  window.Standalone = {
    init(c) {
      ctx = c;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      if (job().result === 'started' && Date.now() - job().at < 15 * 60e3) { c.S.refreshStarted = job().at; follow(); }
      checkPrices();
      /* Prices are looked for without any button: at start, whenever the app comes back to the
         front (at most every 5 minutes), when the connection returns, and every 15 minutes while
         it is open. A check downloads a small file and only decrypts it when it is new. */
      const stale = () => !state().checkedAt || Date.now() - Date.parse(state().checkedAt) > 5 * 60e3;
      document.addEventListener('visibilitychange', () => { if (!document.hidden && stale()) checkPrices(); });
      window.addEventListener('online', () => { if (stale()) checkPrices(); });
      setInterval(() => { if (!document.hidden) checkPrices(); }, 15 * 60e3);
    },
    panelHTML, bind, refreshList, checkPrices, lastDue,
    afterImport: 'If this import has a new instrument, copy the refresh list to GitHub again (This device, below) to get its price.',
  };
})();
