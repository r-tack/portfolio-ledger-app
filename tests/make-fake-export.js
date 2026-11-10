// Builds a small, completely made-up broker export in the layout Saxo Bank uses
// (Dutch headers, three sheets: "Transacties", "_Transacties" and "Bookings"), plus the main
// sheet on its own as a .csv file.
// Every name, symbol, ISIN, account and amount in it is invented.
//
//   node tests/make-fake-export.js [out.xlsx]
//
// SheetJS is taken from XLSX_PATH (a path to xlsx.full.min.js) or from node_modules
// (npm install in this folder).
const fs = require('fs');
const path = require('path');
const XLSX = require(process.env.XLSX_PATH || 'xlsx');

const out = process.argv[2] || path.join(__dirname, 'fixtures', 'FakeBroker_Transactions_2026-01-01_2026-06-30.xlsx');

// A date cell exactly as Excel stores it: a serial day number with a date format.
const D = iso => ({ t: 'n', v: (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5, z: 'yyyy-mm-dd' });
const DT = (iso, hm) => { const c = D(iso); const [h, m] = hm.split(':').map(Number); c.v += (h * 60 + m) / 1440; c.z = 'yyyy-mm-dd hh:mm'; return c; };
// `undefined` = no cell at all (a column the user cleared). '' = the broker's own empty text.
function sheet(header, rows) {
  const ws = {};
  [header, ...rows].forEach((row, r) => row.forEach((v, c) => {
    if (v === undefined) return;
    const cell = typeof v === 'object' ? v : typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) };
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } });
  return ws;
}

const ROBO = ['Example Robotics Inc.', 'EXRB:xnas', 'ZZ0000000017', 'USD', 'Stock', 'NASDAQ'];
const FOOD = ['Sample Foods N.V.', 'SMPF:xams', 'ZZ0000000025', 'EUR', 'Stock', 'Euronext Amsterdam'];
const NONE = ['', '', '', '', '', ''];

// Main sheet, newest first like the real export. "Gebruikersnaam" stands for a column the user
// blanked out before importing: it has a header but no cells, so the import must drop it and put
// it on the never-import list. "Opmerking" and "Correction reason" hold the broker's own blanks
// ('' and '-') and must be kept.
const mainHeader = ['Transactiedatum', 'Valutadatum', 'Transactietype', 'Acties', 'Boekingsbedrag', 'Valuta', 'Omrekeningskoers',
  'Conversion cost', 'Totale kosten', 'Gerealiseerde W/V', 'Opmerking', 'Correction reason', 'Instrument', 'Instrumentsymbool',
  'Instrument ISIN', 'Instrumentvaluta', 'Type', 'Uitwisselingsbeschrijving', 'From Derivative', 'Underlying asset type', 'Gebruikersnaam'];
const m = (date, vdate, type, action, amount, fx, conv, cost, realized, inst) =>
  [D(date), D(vdate), type, action, amount, 'EUR', fx, conv, cost, realized, '', '-', ...inst, 'No', '', undefined];
const main = [
  m('2026-06-15', '2026-06-15', 'Geldoverboeking', 'Opname', -500, 1, 0, 0, '', NONE),
  m('2026-05-20', '2026-05-22', 'Transactie', 'Verkoop 10 @ 120,00 USD', 1100.9, 0.92, -1.1, -2, 178.75, ROBO),
  m('2026-03-16', '2026-03-16', 'Corporate action', 'Contant dividend', 10.95, 0.92, 0, 0, '', ROBO),
  m('2026-02-03', '2026-02-05', 'Transactie', 'Koop 50 @ 40,00 EUR', -2003, 1, 0, -3, 0, FOOD),
  m('2026-01-12', '2026-01-14', 'Transactie', 'Koop 20 @ 100,00 USD', -1844.3, 0.92, -1.8, -2.5, 0, ROBO),
  m('2026-01-05', '2026-01-05', 'Geldoverboeking', 'Storting', 10000, 1, 0, 0, '', NONE),
];

const tradeHeader = ['Rekening-ID', 'Transactie-ID', 'Bk Record Id', 'Booking Id', 'Corporate action-Id', 'Acties', 'Order-ID',
  'Aangepaste transactiedatum', 'Trade execution date', 'Trade Event Type', 'Trade Type', 'Openen/sluiten', 'Traded Quantity', 'Prijs',
  'Verhandelde waarde', 'Spreadkosten', 'From Derivative', 'Underlying asset type', 'Instrument', 'Instrumentsymbool', 'Instrument ISIN',
  'Instrumentvaluta', 'Type', 'Uitwisselingsbeschrijving'];
const t = (tid, action, order, date, time, kind, oc, qty, price, inst) =>
  ['DEMO-0001', tid, 9000000 + tid % 100, 8000000 + tid % 100, '', action, order, D(date), DT(date, time), 'Trade', kind, oc, qty, price,
    -qty * price, 0, 'No', '', ...inst];
const trades = [
  t(5000003, 'Verkoop 10 @ 120,00 USD', 6000003, '2026-05-20', '15:42', 'Limit', 'Sluiten', -10, 120, ROBO),
  t(5000002, 'Koop 50 @ 40,00 EUR', 6000002, '2026-02-03', '09:15', 'Market', 'Openen', 50, 40, FOOD),
  t(5000001, 'Koop 20 @ 100,00 USD', 6000001, '2026-01-12', '16:05', 'Market', 'Openen', 20, 100, ROBO),
];

const bookHeader = ['Rekening-ID', 'Transactie-ID', 'Bk Record Id', 'Booking Id', 'Corporate action-Id', 'Acties', 'Amount Type',
  'Amount Type Id', 'Boekingsbedrag', 'Conversion cost', 'Omrekeningskoers', 'Boekingsdatum', 'Ex-datum', 'Transactiedatum',
  'Eligible quantity', 'Dividend per share', 'Tax Percentage', 'Instrument', 'Instrumentsymbool', 'Instrument ISIN', 'Instrumentvaluta'];
const b = (tid, ca, action, type, typeId, amount, conv, fx, bdate, ex, elig, dps, pct, inst) =>
  ['DEMO-0001', tid, '', '', ca, action, type, typeId, amount, conv, fx, D(bdate), ex ? D(ex) : '', D(bdate), elig, dps, pct, ...inst.slice(0, 4)];
// The dividend: 20 shares x 1,00 USD at 0.92 = 18,40 EUR gross, 15% US withholding tax, then 30% Belgian tax on what is left.
const bookings = [
  b(5000003, '', 'Verkoop 10 @ 120,00 USD', 'Share Amount', 1, 1104, -1.1, 0.92, '2026-05-20', null, '', '', '', ROBO),
  b(5000003, '', 'Verkoop 10 @ 120,00 USD', 'Commission', 2, -2, 0, 0.92, '2026-05-20', null, '', '', '', ROBO),
  b('', 7000001, 'Contant dividend', 'Corporate actions - Cash Dividends', 30, 18.4, 0, 0.92, '2026-03-16', '2026-03-02', 20, '1,00 USD', '', ROBO),
  b('', 7000001, 'Contant dividend', 'Corporate actions - Bronbelasting', 31, -2.76, 0, 0.92, '2026-03-16', '2026-03-02', 20, '1,00 USD', 15, ROBO),
  b('', 7000001, 'Contant dividend', 'Corporate actions - Roerende voorheffing', 32, -4.69, 0, 0.92, '2026-03-16', '2026-03-02', 20, '1,00 USD', 30, ROBO),
  b(5000002, '', 'Koop 50 @ 40,00 EUR', 'Share Amount', 1, -2000, 0, 1, '2026-02-03', null, '', '', '', FOOD),
  b(5000002, '', 'Koop 50 @ 40,00 EUR', 'Commission', 2, -3, 0, 1, '2026-02-03', null, '', '', '', FOOD),
  b(5000001, '', 'Koop 20 @ 100,00 USD', 'Share Amount', 1, -1840, -1.8, 0.92, '2026-01-12', null, '', '', '', ROBO),
  b(5000001, '', 'Koop 20 @ 100,00 USD', 'Commission', 2, -2.5, 0, 0.92, '2026-01-12', null, '', '', '', ROBO),
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet(mainHeader, main), 'Transacties');
XLSX.utils.book_append_sheet(wb, sheet(tradeHeader, trades), '_Transacties');
XLSX.utils.book_append_sheet(wb, sheet(bookHeader, bookings), 'Bookings');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('wrote', out);

// The same main sheet as a CSV file, the way European brokers often write one: semicolons between
// fields, day-month-year dates and amounts like 10.000,00. Only the main sheet: a CSV has one table.
const csvOut = out.replace(/\.xlsx$/i, '.csv');
const iso = c => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c.v * 864e5)); return d.toISOString().slice(0, 10).split('-').reverse().join('-'); };
const eur = v => { const [i, f] = Math.abs(v).toFixed(2).split('.'); return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + f; };
const field = v => { const s = v === undefined ? '' : typeof v === 'object' ? iso(v) : typeof v === 'number' ? (Number.isInteger(v) && Math.abs(v) < 1000 ? String(v) : eur(v)) : String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.writeFileSync(csvOut, '\uFEFF' + [mainHeader, ...main].map(r => r.map(field).join(';')).join('\r\n') + '\r\n');
console.log('wrote', csvOut);
