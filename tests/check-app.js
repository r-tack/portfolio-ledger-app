// End-to-end check of the standalone web app (portfolio-ledger.html + app/local.js) in a real
// browser. Uses only the made-up export in tests/fixtures, and made-up prices.
//
//   node tests/check-app.js
//
// Builds the app with app/build.py into a temporary folder and serves it from http://localhost.
// Needs Playwright with Chromium, Python 3 with the "cryptography" package (to write an encrypted
// prices file the way the daily job does), and d3 and SheetJS as for check-page.js (D3_PATH,
// XLSX_PATH or npm install). Nothing is fetched from the internet.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'FakeBroker_Transactions_2026-01-01_2026-06-30.xlsx');
const OUT = path.join(__dirname, 'out');
const D3 = process.env.D3_PATH || path.join(__dirname, 'node_modules', 'd3', 'dist', 'd3.min.js');
const XL = process.env.XLSX_PATH || path.join(__dirname, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
for (const f of [FIXTURE, D3, XL]) if (!fs.existsSync(f)) { console.error('Missing ' + f); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-site-'));
execFileSync('python3', [path.join(ROOT, 'app', 'build.py'), SITE]);
const PASS = 'correct horse battery staple';

// Writes SITE/prices.json.enc with refresh/standalone.py's own encrypt(), from made-up documents.
function writePrices(docs, extra) {
  const src = path.join(SITE, '..', path.basename(SITE) + '-prices.json');
  fs.writeFileSync(src, JSON.stringify(Object.assign({ v: 1, generatedAt: new Date().toISOString(), docs }, extra || {})));
  execFileSync('python3', ['-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); import standalone as s; open(sys.argv[4], "wb").write(s.encrypt(json.load(open(sys.argv[2])), sys.argv[3]))',
    path.join(ROOT, 'refresh'), src, PASS, path.join(SITE, 'prices.json.enc')]);
}
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.enc': 'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  const p = path.join(SITE, decodeURIComponent(rq.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(SITE) || !fs.existsSync(p)) { rs.writeHead(404); rs.end('not found'); return; }
  rs.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); rs.end(fs.readFileSync(p));
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  —  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const outside = new Set();
  async function open(opts = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' }, opts));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) }).catch(() => {});
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|prices\.json\.enc/.test(m.text() + ((m.location() || {}).url || ''))) errors.push('console: ' + m.text()); });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(BASE)) return r.continue();
      outside.add(new URL(u).host);
      if (u.startsWith('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/')) return r.fulfill({ path: D3, contentType: 'application/javascript' });
      if (u.startsWith('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/')) return r.fulfill({ path: XL, contentType: 'application/javascript' });
      return r.abort();
    });
    return { ctx, page, errors };
  }
  const settle = page => page.waitForTimeout(500);
  const body = page => page.evaluate(() => document.body.innerText);
  const pricesLine = page => page.$eval('#sa-prices', e => e.textContent);
  const waitImported = page => page.waitForFunction(() => /^Imported .*GitHub/.test((document.querySelector('#imp-status') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});

  // 1. First start: empty, stored on this device, no sign-in.
  const { ctx, page, errors } = await open();
  await page.clock.install();
  await page.goto(BASE);
  const empty = await page.waitForSelector('text=No transactions yet', { timeout: 8000 }).then(() => true, () => false);
  check('First start: "No transactions yet", not "Sign in"', empty && !(await body(page)).includes('Sign in to see your portfolio'));
  await page.click('#go-import'); await settle(page);
  check('Transactions page shows the "This device" panel', !!(await page.$('#sa-panel')) && (await body(page)).includes('Your data is stored only on this device'));
  check('Without a passphrase: asks for it, copy button is off while there is nothing to list',
    /Enter the prices passphrase/.test(await pricesLine(page)) && await page.$eval('#sa-copy', b => b.disabled), await pricesLine(page));

  // 2. Import, then reload: the data is still there (kept in the browser's IndexedDB).
  await page.setInputFiles('#imp-file', FIXTURE); await waitImported(page); await settle(page);
  const status = await page.$eval('#imp-status', e => e.textContent).catch(() => '');
  check('Import works and points to the refresh list', /^Imported /.test(status) && status.includes('copy the refresh list to GitHub'), status);
  check('6 transactions after the import', (await page.$$('.txrow')).length === 6);
  await page.reload(); await page.waitForSelector('.txrow', { timeout: 8000 }).catch(() => {}); await settle(page);
  check('After a reload the 6 transactions are still there', (await page.$$('.txrow')).length === 6);

  // 3. The refresh list: instruments only, no quantities or amounts.
  check('Refresh list is marked as changed before the first copy', (await page.$eval('#sa-panel', e => e.innerText)).includes('changed since you last copied it'));
  await page.click('#sa-copy'); await settle(page);
  const list = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  const rows = list.imports.list.sheets.Instruments.rows;
  check('Copied list: the two made-up instruments, each with one trade date and price',
    rows.length === 2 && rows[0][0] === 'EXRB:xnas' && rows[0][6] === '2026-01-12' && rows[0][7] === 100 && rows[1][0] === 'SMPF:xams' && rows[1][7] === 40 && list.imports.list.period.from === '2026-01-05', rows);
  const flat = JSON.stringify(list);
  check('Copied list holds no amounts, quantities, cash or account', !/1844|2003|10000|6764|1100\.9|DEMO-0001|Storting|Koop|"qty"/.test(flat), `${flat.length} characters`);
  check('After copying, the "changed" mark is gone', !(await page.$eval('#sa-panel', e => e.innerText)).includes('changed since you last copied it'));

  // 4. The daily job itself, offline: refresh/standalone.py refuses to run without its two secrets.
  let refused = ''; try { execFileSync('python3', [path.join(ROOT, 'refresh', 'standalone.py'), path.join(SITE, 'none'), path.join(SITE, 'x.enc')], { env: { PATH: process.env.PATH }, stdio: 'pipe' }); } catch (e) { refused = String(e.stderr); }
  check('Daily job stops without its secrets and writes nothing', /must both be set/.test(refused) && !fs.existsSync(path.join(SITE, 'x.enc')));

  // 5. Prices: no file yet, wrong passphrase, right passphrase.
  await page.fill('#sa-pass', PASS); await page.click('#sa-pass-save'); await settle(page);
  check('Passphrase saved, no file published yet: says so', /No prices file has been published yet/.test(await pricesLine(page)), await pricesLine(page));
  const day = new Date().toISOString().slice(0, 10), closes = [['2026-01-02', 95], ['2026-01-12', 100], ['2026-06-30', 130], [day, 150]];
  writePrices({
    'market/EXRB': { symbol: 'EXRB', name: 'Example Robotics', currency: 'USD', price: 150, closes },
    'market/EURUSD~3DX': { symbol: 'EURUSD=X', name: 'EUR/USD', currency: 'USD', price: 1.1, closes: closes.map(c => [c[0], 1.1]) },
    'instruments/EXRB:xnas': { saxo: 'EXRB:xnas', yahoo: 'EXRB', name: 'Example Robotics', ticker: 'EXRB', currency: 'USD', assetClass: 'Shares', monogram: 'E' },
    'meta/refresh': { pricesAsOf: day, fetchedAt: new Date().toISOString(), source: 'Yahoo Finance (daily closes)' },
    'imports/evil': { sheets: {} },
  }, { report: '# Refresh\n\n## NEEDS REVIEW\n- New instrument SMPF:xams (Sample Foods N.V.): no price data found.\n' });
  await page.fill('#sa-pass', 'not the passphrase'); await page.click('#sa-pass-save'); await settle(page); await page.waitForTimeout(600);
  check('Wrong passphrase: clear message, nothing changed', /passphrase doesn't match/.test(await pricesLine(page)) && (await page.$eval('#asof', e => e.textContent)) === 'No prices yet', await pricesLine(page));
  await page.fill('#sa-pass', PASS); await page.click('#sa-pass-save'); await page.waitForFunction(() => /^Prices /.test(document.querySelector('#asof').textContent), null, { timeout: 8000 }).catch(() => {}); await settle(page);
  const asof = await page.$eval('#asof', e => e.textContent);
  check('Right passphrase: prices are downloaded and decrypted, header shows their date', /^Prices /.test(asof), asof);
  check('The refresh notes from the encrypted file are shown', (await page.$eval('#sa-panel', e => e.innerText)).includes('The daily refresh has notes for you'));
  check('The prices file cannot add or replace imports', (await page.$$('.txrow')).length === 6 && (await page.$eval('#imp-details', e => e.innerText)).match(/(\d+) file/)[1] === '1');
  await page.click('#tab-overview'); await settle(page);
  const ov = await body(page);
  await page.screenshot({ path: path.join(OUT, 'app-1-overview.png'), fullPage: true });
  // 10 shares x 150 USD / 1.10 = 1363,64 EUR
  check('Overview values the priced position with the downloaded price (10 × $150 at 1,10 = € 1.363,64)', /1\.363,64/.test(ov) && ov.includes('1 position has no price data yet'));
  await page.click('#tab-transactions'); await settle(page);
  await page.screenshot({ path: path.join(OUT, 'app-2-this-device.png'), fullPage: true });

  // 5b. Prices arrive without any button: a new file is published while the app is open.
  check('There is no "Check now" button', !(await page.$('#sa-check')) && !(await body(page)).includes('Check now'));
  const later = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  writePrices({ 'meta/refresh': { pricesAsOf: later, fetchedAt: new Date().toISOString(), source: 'Yahoo Finance (daily closes)' },
    'market/EXRB': { symbol: 'EXRB', name: 'Example Robotics', currency: 'USD', price: 160, closes: closes.concat([[later, 160]]) } });
  await page.clock.fastForward(16 * 60e3); await page.waitForFunction(d => document.querySelector('#asof').textContent.includes(d), new Date(later + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), { timeout: 8000 }).catch(() => {});
  const asofLater = await page.$eval('#asof', e => e.textContent);
  check('A new prices file is picked up by itself while the app is open (no click)', asofLater.includes(new Date(later + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })), asofLater);
  const checks1 = await page.evaluate(() => JSON.parse(localStorage.getItem('pl:prices')).checkedAt);
  await page.clock.fastForward(16 * 60e3); await settle(page);
  check('A check that finds the same file changes nothing on screen', (await page.evaluate(() => JSON.parse(localStorage.getItem('pl:prices')).status)) === 'ok' && (await page.evaluate(() => JSON.parse(localStorage.getItem('pl:prices')).checkedAt)) !== checks1);

  // 6. Backup on this device, restore on a "second device" (a fresh browser profile).
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sa-backup')]);
  const bfile = path.join(SITE, '..', path.basename(SITE) + '-backup.json'); await dl.saveAs(bfile);
  const b = JSON.parse(fs.readFileSync(bfile, 'utf8'));
  check('Backup file holds the import, settings and prices', b.format === 'portfolio-ledger-backup' && Object.keys(b.docs).some(k => k.startsWith('imports/')) && b.docs['settings/columns'] && b.docs['meta/refresh'], Object.keys(b.docs).map(k => k.split('/')[0]).filter((x, i, a) => a.indexOf(x) === i));
  check('Standalone app: no errors', !errors.length, errors.length ? errors : 'none');
  await ctx.close();

  fs.unlinkSync(path.join(SITE, 'prices.json.enc'));
  const two = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await two.page.goto(BASE + '#transactions'); await two.page.waitForSelector('#sa-panel', { timeout: 8000 }).catch(() => {}); await settle(two.page);
  check('Second device starts empty', (await two.page.$$('.txrow')).length === 0);
  await two.page.setInputFiles('#sa-restore-file', path.join(__dirname, 'fixtures', 'FakeBroker_Transactions_2026-01-01_2026-06-30.csv')); await settle(two.page);
  check('Restore refuses a file that is not a backup', (await two.page.$$('.txrow')).length === 0 && /isn't a Portfolio Ledger backup/.test(await two.page.$eval('.toast', e => e.textContent).catch(() => '')));
  await two.page.setInputFiles('#sa-restore-file', bfile); await two.page.waitForSelector('.txrow', { timeout: 8000 }).catch(() => {}); await settle(two.page);
  const asof2 = await two.page.$eval('#asof', e => e.textContent);
  check('Second device after restore: the same 6 transactions and prices', (await two.page.$$('.txrow')).length === 6 && /Prices|\d{4}|Nov|[A-Z][a-z]{2}/.test(asof2), asof2);
  await two.page.screenshot({ path: path.join(OUT, 'app-3-phone.png') });
  check('Phone width (390 px): no sideways scrolling', !(await two.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  check('Second device: no errors', !two.errors.length, two.errors.length ? two.errors : 'none');
  await two.ctx.close();

  // 7. Installable and usable offline: manifest, icons and the service worker.
  const three = await open({ serviceWorkers: 'allow' });
  await three.page.goto(BASE); await three.page.waitForSelector('text=No transactions yet', { timeout: 8000 }).catch(() => {});
  const man = await three.page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); const ic = await Promise.all(m.icons.map(i => fetch(i.src).then(r => r.ok))); return { display: m.display, icons: ic, touch: !!document.querySelector('link[rel=apple-touch-icon]') }; });
  check('Install info: manifest (standalone), icons and the iPhone home-screen icon', man.display === 'standalone' && man.icons.every(Boolean) && man.touch, man);
  await three.page.evaluate(() => navigator.serviceWorker.ready); await three.page.reload(); await three.page.waitForSelector('text=No transactions yet').catch(() => {}); await settle(three.page);
  await three.ctx.setOffline(true); server.close(); if (server.closeAllConnections) server.closeAllConnections();
  await three.page.reload().catch(() => {});
  const offline = await three.page.waitForSelector('text=No transactions yet', { timeout: 8000 }).then(() => true, () => false);
  check('Offline: the app still opens from its cache', offline);
  await three.ctx.close();

  await browser.close();
  check('Only cdnjs and Google Fonts were contacted (both answered locally or blocked)', [...outside].every(h => /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h)), [...outside]);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
