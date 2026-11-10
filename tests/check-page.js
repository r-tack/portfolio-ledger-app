// End-to-end check of portfolio-ledger.html in a real browser, with a mocked, empty database.
// Uses only the made-up exports in tests/fixtures (see make-fake-export.js), never real data.
// Covers the empty state, the .xlsx and .csv imports, and starting the price refresh after an import
// (the Claude Code Remote connector is mocked: nothing is sent anywhere).
//
//   node tests/check-page.js
//
// Needs Playwright with Chromium (require('playwright') must work) and local copies of the two
// libraries the page loads from cdnjs: d3 7.9.0 and SheetJS 0.18.5. Run `npm install` in tests/
// or point D3_PATH and XLSX_PATH at d3.min.js and xlsx.full.min.js. Nothing is fetched from the
// internet: every outside request is answered locally or blocked. Screenshots go to tests/out/.
// With DUMP_DIR set, the documents the import stored are also written there, one file per
// document (DUMP_DIR/<collection>/<id>.json), the layout refresh/refresh.py reads. PAGE_PATH tests
// another copy of the page.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE_PATH = process.env.PAGE_PATH || path.join(ROOT, 'portfolio-ledger.html');
const FIXTURE = path.join(__dirname, 'fixtures', 'FakeBroker_Transactions_2026-01-01_2026-06-30.xlsx');
const FIXTURE_CSV = FIXTURE.replace(/\.xlsx$/, '.csv');
const OUT = path.join(__dirname, 'out');
const D3 = process.env.D3_PATH || path.join(__dirname, 'node_modules', 'd3', 'dist', 'd3.min.js');
const XL = process.env.XLSX_PATH || path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
for (const f of [PAGE_PATH, FIXTURE, FIXTURE_CSV, D3, XL]) if (!fs.existsSync(f)) { console.error('Missing ' + f); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// claude.ai wraps the published file in a document skeleton like this one.
const PAGE = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}'
  + 'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n' + fs.readFileSync(PAGE_PATH, 'utf8') + '</body></html>';

// A small in-memory stand-in for the artifact database: documents by path, live listeners,
// and a log of every write. `mode` is 'db' (signed in), 'none' (no window.claude), 'null'
// (use() gives nothing back) or 'throw' (use() refuses). `opts.owner` is what user.isOwner() says
// (default true). `opts.mcp` stands in for the Claude Code Remote connector: 'ok' (default) answers
// every call, an error code such as 'not_in_manifest' refuses it, null means no mcp capability.
// Every connector call is logged in window.__mock.MCP.
function mockScript(mode, seed, opts = {}) {
  return `(() => {
  const MODE = ${JSON.stringify(mode)}, OPTS = ${JSON.stringify(opts)};
  if (MODE === 'none') return;
  const OWNER = OPTS.owner !== false, MCP_MODE = OPTS.mcp === undefined ? 'ok' : OPTS.mcp, MCP = [];
  const mcp = MCP_MODE === null ? null : { callTool: async (server, tool, input) => {
    MCP.push({ server, tool, input });
    if (MCP_MODE !== 'ok') throw { code: MCP_MODE, message: 'refused by the test' };
    return { content: [{ type: 'text', text: '{}' }], payload: {} }; } };
  const DOCS = ${JSON.stringify(seed || {})}, docL = new Map(), colL = new Map(), WRITES = [];
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const snapDoc = p => ({ id: p.split('/').pop(), exists: DOCS[p] !== undefined, data: () => clone(DOCS[p]), metadata: { fromCache: false, hasPendingWrites: false } });
  const snapCol = c => { const docs = Object.keys(DOCS).filter(k => k.split('/')[0] === c && k.split('/').length === 2).sort().map(snapDoc); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } }; };
  const listen = (map, k, fn, snap) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(fn); setTimeout(() => fn(snap()), 20); return () => map.get(k).delete(fn); };
  const changed = p => setTimeout(() => { const c = p.split('/')[0]; (docL.get(p) || []).forEach(f => f(snapDoc(p))); (colL.get(c) || []).forEach(f => f(snapCol(c))); }, 5);
  let n = 0;
  const doc = p => ({ id: p.split('/').pop(), path: p,
    onSnapshot: fn => listen(docL, p, fn, () => snapDoc(p)), get: async () => snapDoc(p),
    set: async d => { DOCS[p] = clone(d); WRITES.push('set ' + p); changed(p); },
    update: async d => { DOCS[p] = Object.assign(DOCS[p] || {}, clone(d)); WRITES.push('update ' + p); changed(p); },
    delete: async () => { delete DOCS[p]; WRITES.push('delete ' + p); changed(p); } });
  const db = { doc, collection: c => ({ doc: id => doc(c + '/' + id), onSnapshot: fn => listen(colL, c, fn, () => snapCol(c)),
    add: async d => { const p = c + '/auto-' + (++n); DOCS[p] = clone(d); WRITES.push('add ' + p); changed(p); return { id: p.split('/')[1] }; } }) };
  window.__mock = { DOCS, WRITES, MCP, db };
  window.claude = { use: async name => {
    if (MODE === 'throw') throw new Error('capability not granted: ' + name);
    if (MODE === 'null') return null;
    return name === 'db' ? db : name === 'user' ? { can: async () => true, isOwner: async () => OWNER } : name === 'mcp' ? mcp : null; } };
})();`;
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  —  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const outside = new Set();
  async function open({ mode = 'db', seed, mock, hash = '#overview', viewport = { width: 1280, height: 860 }, file = false, mobile = false } = {}) {
    const ctx = await browser.newContext(mobile ? { viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() !== 'error') return; const where = (m.location() && m.location().url) || ''; if (!/fonts\.(googleapis|gstatic)\.com/.test(where + m.text())) errors.push('console: ' + m.text() + ' ' + where); });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith('http://local/')) return r.fulfill({ body: PAGE, contentType: 'text/html' });
      if (u.startsWith('file:') || u.startsWith('data:')) return r.continue();
      outside.add(new URL(u).host);
      if (u.startsWith('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/')) return r.fulfill({ path: D3, contentType: 'application/javascript' });
      if (u.startsWith('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/')) return r.fulfill({ path: XL, contentType: 'application/javascript' });
      return r.abort();
    });
    if (!file) await page.addInitScript(mockScript(mode, seed, mock));
    await page.goto(file ? 'file://' + PAGE_PATH : 'http://local/index.html' + hash);
    return { ctx, page, errors };
  }
  const text = page => page.evaluate(() => document.body.innerText);
  const shot = (page, name, full) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
  const docs = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__mock.DOCS)));
  const settle = page => page.waitForTimeout(400);

  // 1. Without the database capability: opened from disk, and on claude.ai without capabilities.
  {
    const { ctx, page, errors } = await open({ file: true });
    const ok = await page.waitForSelector('text=Sign in to see your portfolio', { timeout: 5000 }).then(() => true, () => false);
    await shot(page, '1-file-from-disk');
    check('Opened from disk: shows "Sign in to see your portfolio"', ok);
    check('Opened from disk: no errors', !errors.length, errors.length ? errors : 'none');
    await ctx.close();
  }
  for (const mode of ['none', 'null', 'throw']) {
    const { ctx, page, errors } = await open({ mode });
    const ok = await page.waitForSelector('text=Sign in to see your portfolio', { timeout: 5000 }).then(() => true, () => false);
    check(`No database (${mode === 'none' ? 'no window.claude' : mode === 'null' ? 'use("db") gives nothing' : 'use("db") refuses'}): shows "Sign in to see your portfolio"`, ok,
      errors.length ? errors : undefined);
    await ctx.close();
  }

  // 2. Empty database: the empty state and the import screen.
  let saved;
  {
    const { ctx, page, errors } = await open({});
    const empty = await page.waitForSelector('text=No transactions yet', { timeout: 5000 }).then(() => true, () => false);
    await settle(page); await shot(page, '2-empty-overview');
    check('Empty database: overview shows "No transactions yet"', empty);
    check('Empty database: no errors on load', !errors.length, errors.length ? errors : 'none');
    for (const tab of ['performance']) {
      await page.click('#tab-' + tab); await settle(page);
      check(`Empty database: ${tab} page shows the empty state`, (await text(page)).includes('No transactions yet'));
    }
    await page.click('#tab-overview'); await settle(page);
    await page.click('#go-import'); await settle(page);
    check('"Go to Transactions" opens the Transactions page', (await page.evaluate(() => location.hash)) === '#transactions', await page.evaluate(() => location.hash));
    const hasPanel = await page.$('#imp-details') && await page.$('#drop') && await page.$('#imp-btn');
    if (!(await page.$eval('#imp-details', d => d.open))) await page.click('#imp-details > summary');
    await settle(page); await shot(page, '3-empty-import-screen', true);
    const t = await text(page);
    check('Import screen: upload button, drop area and never-import lists are shown', hasPanel && t.includes('Drop a newer .xlsx or .csv export here') && t.includes('Never imported'),
      `0 files, never-import lists: ${(t.match(/\bNone\b/g) || []).length} × "None"`);
    check('Empty database: nothing written before an import', !(await page.evaluate(() => window.__mock.WRITES.length)), await page.evaluate(() => window.__mock.WRITES));

    // 3. Import the made-up Saxo-style export through the real file input.
    await page.setInputFiles('#imp-file', FIXTURE);
    const seen = await page.waitForFunction(() => { const t = (document.querySelector('#imp-status') || {}).textContent || ''; return /^Imported /.test(t) && t; }, null, { timeout: 15000 }).then(h => h.jsonValue(), () => null);
    const done = !!seen, status = seen || await page.$eval('#imp-status', e => e.textContent).catch(() => '(no status)');
    await settle(page); await shot(page, '4-after-import', true);
    check('Import finishes', done, status);
    const d = await docs(page), writes = await page.evaluate(() => window.__mock.WRITES);
    if (process.env.DUMP_DIR) for (const [k, v] of Object.entries(d)) { const f = path.join(process.env.DUMP_DIR, k + '.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); }
    const impKeys = Object.keys(d).filter(k => k.startsWith('imports/')), imp = d[impKeys[0]] || {};
    const sh = imp.sheets || {};
    check('Writes: one imports/ document and settings/columns, nothing else', impKeys.length === 1 && writes.every(w => /^set (imports\/|settings\/columns$)/.test(w)), writes);
    check('Stored import: all three sheets with every row', sh.Transacties && sh.Transacties.rows.length === 6 && sh._Transacties && sh._Transacties.rows.length === 3 && sh.Bookings && sh.Bookings.rows.length === 9,
      Object.fromEntries(Object.entries(sh).map(([k, v]) => [k, `${v.rows.length} rows × ${v.columns.length} columns`])));
    check('Stored import: the cleared column "Gebruikersnaam" was dropped', sh.Transacties && !sh.Transacties.columns.includes('Gebruikersnaam') && JSON.stringify(imp.dropped) === JSON.stringify({ Transacties: ['Gebruikersnaam'], _Transacties: [], Bookings: [] }), imp.dropped);
    check("Stored import: the broker's own blank columns are kept (Opmerking, Correction reason)", sh.Transacties && sh.Transacties.columns.includes('Opmerking') && sh.Transacties.columns.includes('Correction reason'));
    check('Stored import: period taken from the file name', imp.period && imp.period.from === '2026-01-01' && imp.period.to === '2026-06-30', imp.period);
    check('Stored import: date cells stored as dates', sh.Transacties && sh.Transacties.rows[0][0] === '2026-06-15' && sh._Transacties.rows[0][8] === '2026-05-20T15:42:00', [sh.Transacties && sh.Transacties.rows[0][0], sh._Transacties && sh._Transacties.rows[0][8]]);
    check('Never-import list now holds "Gebruikersnaam"', d['settings/columns'] && JSON.stringify(d['settings/columns'].exclude) === JSON.stringify({ main: ['Gebruikersnaam'] }), d['settings/columns'] && d['settings/columns'].exclude);
    check('No settings/refresh: the price refresh is not started, prices follow at the next refresh',
      !(await page.evaluate(() => window.__mock.MCP.length)) && /at the next price refresh\.$/.test(await page.$eval('#imp-status', e => e.textContent)), await page.$eval('#imp-status', e => e.textContent));

    // 4. What the imported data looks like on each page.
    const rows = await page.$$eval('.txrow', a => a.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    check('Transactions: 6 rows', rows.length === 6, rows);
    await page.click('.txrow:has-text("dividend") .txmain'); await settle(page);
    const divSheet = await page.$eval('#sheet-root', e => e.innerText.replace(/\s+/g, ' '));
    await shot(page, '5-dividend-detail');
    check('Dividend detail: gross 18,40, 15% withholding −2,76, 30% Belgian tax −4,69, net 10,95',
      ['18,40', '2,76', '4,69', '10,95'].every(s => divSheet.includes(s)), divSheet.slice(0, 400));
    await page.keyboard.press('Escape'); await settle(page);

    await page.click('#tab-overview'); await settle(page);
    const ov = await text(page);
    await shot(page, '6-overview', true);
    check('Overview: both made-up positions are listed', ov.includes('Example Robotics Inc.') && ov.includes('Sample Foods N.V.'));
    check('Overview: cash balance € 6.764,55', /6\.764,55/.test(ov));
    check('Overview: "no price data yet" notice (the database has no prices)', ov.includes('2 positions have no price data yet'));
    check('Header: "No prices yet" (no price refresh has run)', (await page.$eval('#asof', e => e.textContent)) === 'No prices yet', await page.$eval('#asof', e => e.textContent));
    await page.click('.hrow:has-text("Example Robotics")'); await settle(page);
    const pos = await page.$eval('#sheet-root', e => e.innerText.replace(/\s+/g, ' '));
    await shot(page, '7-position-sheet');
    check('Position sheet: 10 shares left after selling 10 of 20', /\b10\b/.test(pos) && pos.includes('Example Robotics'), pos.slice(0, 300));
    await page.keyboard.press('Escape'); await settle(page);

    await page.click('#tab-performance'); await settle(page);
    const perf = await page.$$eval('#main svg', a => a.length);
    await shot(page, '8-performance', true);
    check('Performance page renders charts', perf > 0, `${perf} svg elements`);
    await page.goto('http://local/index.html#dividends'); await page.waitForTimeout(800);
    const dv = await text(page);
    await shot(page, '9-dividends', true);
    check('Dividends page shows the dividend (10,95 net)', dv.includes('10,95'));
    check('No errors during import and browsing', !errors.length, errors.length ? errors : 'none');
    saved = await docs(page);
    await ctx.close();
  }

  // 5. Reload with what was saved, then import the same file again (overlapping dates replace the older import).
  {
    const { ctx, page, errors } = await open({ seed: saved, hash: '#transactions' });
    await page.waitForSelector('.txrow', { timeout: 5000 }).catch(() => {}); await settle(page);
    check('Reload: the saved import shows the same 6 transactions', (await page.$$('.txrow')).length === 6);
    await page.setInputFiles('#imp-file', FIXTURE);
    await page.waitForFunction(() => /^Imported /.test((document.querySelector('#imp-status') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const status = await page.$eval('#imp-status', e => e.textContent).catch(() => '');
    await settle(page);
    check('Re-import of the same period: still 6 transactions, no duplicates', (await page.$$('.txrow')).length === 6, status);
    check('Re-import: "Gebruikersnaam" is now left out because it is on the never-import list', /Left out 1 column: Gebruikersnaam\. /.test(status), status);
    check('Reload and re-import: no errors', !errors.length, errors.length ? errors : 'none');
    await ctx.close();
  }

  // 6. Price refresh right after an import: settings/refresh names the owner's scheduled task, and
  //    the page starts it through the Claude Code Remote connector (mocked here; nothing is sent).
  const TRIG = 'trig_0123456789abcdefTEST';
  // The status line reads "Imported …" once the file is saved, and gains a sentence about the refresh once that is decided.
  const waitImported = page => page.waitForFunction(() => /^Imported .*refresh/.test((document.querySelector('#imp-status') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  {
    const { ctx, page, errors } = await open({ seed: { 'settings/refresh': { trigger: TRIG } }, hash: '#transactions' });
    await page.waitForSelector('#imp-btn', { timeout: 5000 }).catch(() => {}); await settle(page);
    check('With settings/refresh: nothing is started before an import', !(await page.evaluate(() => window.__mock.MCP.length)));
    await page.setInputFiles('#imp-file', FIXTURE); await waitImported(page); await settle(page);
    const calls = await page.evaluate(() => window.__mock.MCP), status = await page.$eval('#imp-status', e => e.textContent).catch(() => '');
    check('After the import: the scheduled task is started once, through Claude Code Remote fire_trigger',
      calls.length === 1 && calls[0].server === 'Claude Code Remote' && calls[0].tool === 'fire_trigger' && calls[0].input.trigger_id === TRIG && Object.keys(calls[0].input).join() === 'trigger_id,text', calls);
    check('Import status says the price refresh has started', status.includes('The price refresh has started.'), status);
    const asof1 = await page.$eval('#asof', e => e.textContent);
    await shot(page, '12-refresh-started');
    check('Header: "Refreshing prices…" while the refresh runs', asof1 === 'Refreshing prices…', asof1);
    // The refresh finishes: it writes meta/refresh, and the header shows the new prices date.
    await page.evaluate(() => window.__mock.db.doc('meta/refresh').set({ pricesAsOf: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), source: 'Yahoo Finance (daily closes)' }));
    await settle(page);
    const asof2 = await page.$eval('#asof', e => e.textContent);
    check('Header: shows the new prices date once the refresh has written meta/refresh', /^Prices /.test(asof2), asof2);
    check('Price refresh after import: no errors', !errors.length, errors.length ? errors : 'none');
    await ctx.close();
  }
  for (const [label, mock, expectCalls, expectText] of [
    ['connector not allowed for the page', { mcp: 'not_in_manifest' }, 1, "Claude Code Remote isn't allowed for this page"],
    ['connector not connected', { mcp: 'server_not_connected' }, 1, "Claude Code Remote isn't connected"],
    ['page published without the mcp capability', { mcp: null }, 0, "This page isn't allowed to use Claude Code Remote"],
    ['an editor who is not the owner', { owner: false }, 0, 'at the next price refresh.'],
  ]) {
    const { ctx, page, errors } = await open({ seed: { 'settings/refresh': { trigger: TRIG } }, mock, hash: '#transactions' });
    await page.waitForSelector('#imp-btn', { timeout: 5000 }).catch(() => {}); await settle(page);
    await page.setInputFiles('#imp-file', FIXTURE); await waitImported(page); await settle(page);
    const calls = await page.evaluate(() => window.__mock.MCP.length), status = await page.$eval('#imp-status', e => e.textContent).catch(() => '');
    const asof = await page.$eval('#asof', e => e.textContent), saved = Object.keys(await docs(page)).some(k => k.startsWith('imports/'));
    check(`Refresh not started (${label}): import saved, ${expectCalls ? 'one refused call' : 'no call'}, clear message, no "Refreshing"`,
      saved && calls === expectCalls && status.includes(expectText) && /next price refresh\.$/.test(status) && asof !== 'Refreshing prices…' && !errors.length, { calls, status, asof, errors });
    await ctx.close();
  }

  // 7. The same made-up export as a CSV file (semicolons, 05-01-2026 dates, amounts like 10.000,00).
  {
    const { ctx, page, errors } = await open({ seed: { 'settings/refresh': { trigger: TRIG } }, hash: '#transactions' });
    await page.waitForSelector('#imp-btn', { timeout: 5000 }).catch(() => {}); await settle(page);
    await page.setInputFiles('#imp-file', FIXTURE_CSV); await waitImported(page); await settle(page);
    const status = await page.$eval('#imp-status', e => e.textContent).catch(() => '');
    const d = await docs(page), imp = d[Object.keys(d).find(k => k.startsWith('imports/'))] || {}, sh = Object.values(imp.sheets || {})[0] || { columns: [], rows: [] };
    check('CSV import finishes and starts the price refresh', /^Imported .*\.csv\./.test(status) && status.includes('The price refresh has started.') && (await page.evaluate(() => window.__mock.MCP.length)) === 1, status);
    check('CSV: one sheet with all 6 rows, period from the file name', sh.rows.length === 6 && imp.period && imp.period.from === '2026-01-01' && imp.period.to === '2026-06-30', { rows: sh.rows.length, period: imp.period });
    check('CSV: empty columns are kept (a CSV cannot tell cleared from empty), nothing added to never-import', sh.columns.includes('Gebruikersnaam') && sh.rows.every(r => r[sh.columns.indexOf('Gebruikersnaam')] == null) && !d['settings/columns'], sh.columns.length + ' columns');
    const rows = await page.$$eval('.txrow', a => a.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    check('CSV: 6 transactions, dates read as day-month-year', rows.length === 6 && rows.some(r => r.includes('15 Jun')) && rows.some(r => r.includes('5 Jan')), rows);
    check('CSV: amounts like 10.000,00 and -1.844,30 read correctly', rows.some(r => r.includes('10.000,00')) && rows.some(r => r.includes('1.844,30')), rows.filter(r => /Deposit|Bought .*Robotics/.test(r)));
    await page.click('#tab-overview'); await settle(page);
    const ov = await text(page);
    check('CSV: overview cash balance € 6.764,55, both positions listed', /6\.764,55/.test(ov) && ov.includes('Example Robotics Inc.') && ov.includes('Sample Foods N.V.'));
    check('CSV import: no errors', !errors.length, errors.length ? errors : 'none');
    await ctx.close();
  }

  // 8. Phone width: empty state and import screen fit without sideways scrolling.
  {
    const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await page.waitForSelector('text=No transactions yet', { timeout: 5000 }).catch(() => {}); await settle(page);
    await shot(page, '10-phone-empty');
    const o1 = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await page.click('#go-import'); await settle(page);
    if (!(await page.$eval('#imp-details', d => d.open))) await page.click('#imp-details > summary');
    await settle(page); await shot(page, '11-phone-import', true);
    const o2 = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check('Phone (390 px): empty state and import screen fit the width', !o1 && !o2);
    check('Phone: no errors', !errors.length, errors.length ? errors : 'none');
    await ctx.close();
  }

  await browser.close();
  check('Only cdnjs and Google Fonts were contacted (both answered locally or blocked)', [...outside].every(h => /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h)), [...outside]);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
