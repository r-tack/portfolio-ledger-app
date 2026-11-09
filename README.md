# Portfolio Ledger

A personal investment tracker that runs as a private page on claude.ai. You import the Excel
export of your broker's transactions, and the page shows:

- your positions and cash;
- your returns compared with market indices;
- your dividends, with the tax withheld on each one;
- every transaction, which you can correct by hand.

It was built around the **Saxo Bank** export, with Dutch or English column names. Other brokers
name their columns differently. Making the import understand your broker's file is usually a
small change, and Claude can make it for you (see [Adapting the import](#3-adapting-the-import-to-your-broker)).

This copy contains nobody's data. When you publish it, your copy starts empty, and what you
import stays in your copy only.

## What's in this repository

| File | What it is |
|---|---|
| `portfolio-ledger.html` | The whole app: one page, published as a claude.ai artifact. |
| `refresh/` | Optional. The daily price refresh: a script plus instructions for a Claude Code scheduled task. |
| `tests/` | A browser test, and a script that makes a small, made-up Saxo-style export to test with. |

## 1. Publish your own copy

You need a claude.ai account where you can use Claude Code, either on the web at
[claude.ai/code](https://claude.ai/code) or in the Claude desktop app.

1. Fork this repository on GitHub (the **Fork** button). This gives you your own copy to change.
2. Start a Claude Code session on your fork.
3. Send Claude this message:

   > Publish portfolio-ledger.html from this repository as a new artifact, unchanged. Give it the
   > database capability with the rules `[{"path": "", "read": "view", "write": "admin"}]`
   > and the "user" capability.

   For reference, the complete capability setting is:

   ```json
   {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}]}, "user": {}}
   ```

4. Claude replies with a link that looks like `https://claude.ai/artifact/...`. That is your
   tracker. Keep the link, because you need it to update the page later and to set up the price
   refresh.

**What the two capabilities do**

- **Database** stores your imports, settings and prices on claude.ai. The rule says that
  anyone who can open the page can read the data (`"read": "view"`), and that only you and the
  people you make editors can change it (`"write": "admin"`).
- **User** lets the page check whether the person looking may change data. If they can't, the
  import and edit buttons are turned off.

> **Your tracker is private until you share it.** Because of the `"read": "view"` rule, anyone
> you share the link with can see your whole portfolio.

**"Sign in to see your portfolio"**

The page shows only this message when it can't reach its database. Usually that means one of
three things:

- **The capabilities are missing.** Ask Claude: *"Republish my tracker <your link> with the
  database capability (rules `[{"path": "", "read": "view", "write": "admin"}]`) and the user
  capability."* Republishing to the same link keeps the data.
- **You aren't signed in to claude.ai** in that browser.
- **You opened `portfolio-ledger.html` from your computer.** The page only works when it is
  published on claude.ai. Opened from disk, it always shows this message.

**Updating your copy later**

After you or Claude change `portfolio-ledger.html`, ask Claude: *"Republish
portfolio-ledger.html to my tracker <your link>."* Your imports and settings are kept.

## 2. Your first import

1. Open your tracker. It says **No transactions yet**.
2. Click **Go to Transactions**, then **Import export**, and choose your broker's `.xlsx` file.
   You can also drop the file on the import area under **Imports & columns**.
3. The file is read in your browser, and only the columns it keeps are saved. A status line
   tells you which columns were left out.

Good to know:

- **Leaving out columns.** Before importing, you can empty any column you don't want stored,
  such as a user name or account number: delete the contents but keep the column title. The
  import leaves that column out and adds it to the **Never imported** list, so later files skip
  it too. Columns your broker always leaves empty are kept, and you can manage the list on the
  same screen.
- **Newer exports.** Importing a newer export replaces the rows in the period it covers, so
  overlapping files don't create duplicates. The period comes from the file name when it
  contains two dates, like `..._2026-01-01_2026-06-30.xlsx`, and from the dates inside
  otherwise.

## 3. Adapting the import to your broker

The quickest way is to tell Claude what your export looks like and ask it to change the page.
You never need to share your real transactions. The **column titles** of your export, the
first row of each sheet, are usually enough.

### Example prompts

> My broker's export calls the amount column "Net amount" instead of "Boekingsbedrag". Update
> the import in portfolio-ledger.html to read it.

> My broker's export has one sheet with the columns Date, Type, Ticker, ISIN, Quantity, Price,
> Currency, Amount and Fees. Update the import in portfolio-ledger.html so it reads these
> columns. Take buys, sells, dividends and deposits from the Type column, and quantity and
> price from their own columns.

> Here are the column titles of my export and two made-up example rows: … Make the import
> understand this layout, add a fake test file in this layout to tests/make-fake-export.js,
> and run tests/check-page.js.

Then ask Claude to republish the page to your tracker's link (see above).

### How the import reads a file

Everything below is in `portfolio-ledger.html`. Line numbers are approximate; searching for the
name always works.

1. **The first row of every sheet must hold the column titles.** If your broker puts a title or
   a blank row above them, the import needs a small change in `readWorkbook` (around line 1941).
2. **Each sheet gets a role from its name** (`sheetRole`, around line 426):
   - a name starting with `_`, like Saxo's `_Transacties`, holds trade details (quantity, price,
     order type);
   - a name containing "book", like `Bookings`, holds the cost and tax lines of each booking;
   - any other name is the main list of transactions. This is the only sheet that is required.
3. **Columns are found by name, using the alias lists in `COLS`** (around line 427, in the
   script with `id="core-js"`). Each entry lists the column titles that mean the same thing,
   and the first one present in the file is used. For example:

   ```js
   amount: ['Boekingsbedrag', 'Booked amount', 'Booking amount'],
   date:   ['Transactiedatum', 'Trade date', 'Transaction date', 'Date'],
   symbol: ['Instrumentsymbool', 'Instrument symbol', 'Symbol'],
   elig:   ['Eligible quantity'],
   dps:    ['Dividend per share'],
   ```

   If your broker calls the amount column "Net amount", adding `'Net amount'` to the `amount`
   list is the whole change. The Dutch titles (Boekingsbedrag, Transactiedatum, Acties,
   Valuta, Omrekeningskoers…) are Saxo's Dutch export; the English ones next to them cover the
   English export.

   The main fields:

   | Key | Meaning | Saxo (Dutch) |
   |---|---|---|
   | `date` | Transaction date | Transactiedatum |
   | `action` | Description, e.g. "Koop 20 @ 100,00 USD" | Acties |
   | `category` | Transaction type | Transactietype |
   | `amount` | Amount booked on your account, in euro | Boekingsbedrag |
   | `symbol`, `instrument`, `isin` | Which security | Instrumentsymbool, Instrument, Instrument ISIN |
   | `iccy` | The security's own currency | Instrumentvaluta |
   | `fx` | Exchange rate used | Omrekeningskoers |
   | `cost`, `conv` | Fees, currency conversion cost | Totale kosten, Conversion cost |
   | `qty`, `price` | Quantity and price (trade details sheet) | Traded Quantity, Prijs |
   | `amtType`, `taxPct` | Kind of booking line and tax rate (bookings sheet) | Amount Type, Tax Percentage |
   | `elig`, `dps` | Shares entitled to a dividend, dividend per share | Eligible quantity, Dividend per share |

4. **Which columns are left out: `cleanSheet`** (around line 415). It drops columns on the
   never-import list and columns whose cells were all emptied in the file. It keeps columns
   where the broker itself wrote empty text or "-". `cellValue` (around line 1933) is where
   Excel cells, including dates, become values.
5. **What kind of transaction a row is** comes from words in the description (around line 520):

   | Kind | Words |
   |---|---|
   | deposit | storting, deposit |
   | withdrawal | opname, withdraw |
   | dividend | dividend |
   | buy | starts with koop, buy, bought, gekocht |
   | sell | starts with verkoop, sell, sold, verkocht |
   | interest | rente, interest |

   If the description says neither buy nor sell, a row whose transaction type contains
   "transact" or "trade" counts as a buy or sell, depending on the sign of the quantity. Add
   your broker's words here if they differ.
6. **Quantity and price** come from the trade details sheet. Without one, they come from the
   description, in the form "Koop 20 @ 100,00 USD" (`parseAction`, around line 465). A broker
   with Quantity and Price columns on the main sheet needs a small change in `buildEvents`
   (around line 503). The second example prompt above asks for exactly that.
7. **Dividend tax lines** are recognised in `dividendInfo` (around line 566): "Bronbelasting"
   or "withholding" is foreign tax, and "Roerende voorheffing" is the Belgian tax.
8. **The upload screen** (drop area, status line, the Never imported lists, the list of past
   imports) is built in `importPanelHTML` (around line 1851). The saving itself happens in
   `importFile` (around line 1957).

### Other things you may want to change

- **Number format.** Amounts are shown in Belgian Dutch style (`1.234,56`), set by
  `const LOC = 'nl-BE'`. Use for example `'en-GB'`, `'de-DE'` or `'fr-FR'` instead.
- **Currency.** The page assumes your account is in euro.
- **Tax.** Dividends show the Belgian tax on dividends (30%, `BE_RV`) and a table of foreign
  withholding tax rates by country (`WHT`). If you don't live in Belgium, ask Claude to change
  or remove this.

### Known limitations

- Numbers stored in Excel as **text** with both a thousands separator and a decimal comma, like
  `"1.234,56"`, are read wrongly, and so are quantities like "1.000" in a description. Real
  Excel numbers are fine, and Saxo uses those for its amounts.
- The Excel reader is SheetJS 0.18.5, loaded from cdnjs. It is the newest version cdnjs offers
  and has published security advisories, fixed in later versions that are only available from
  SheetJS's own site. Only import files you downloaded from your broker.

## What's not included

- **No data.** None of the original owner's transactions, positions, settings or prices are
  included. Your database starts empty.
- **No price refresh.** The page doesn't fetch prices itself; a separate scheduled task does
  (see below). Until it runs, the header says **No prices yet**, positions are valued at what
  you paid for them, and the benchmark lines on the Performance page stay empty. Logos, sectors
  and countries also come from the refresh.

## Optional: a daily price refresh

The `refresh/` folder sets up a Claude Code session in the cloud that runs every weekday. It
reads your tracker's database, fetches closing prices from Yahoo Finance for your instruments,
the benchmarks and the currencies you use, and writes them back. It never changes the page.

1. Create a new **private** GitHub repository, for example `my-ledger-refresh`, and put the
   contents of `refresh/` at its top level:
   - `refresh.py`, the script;
   - `CLAUDE.md`, the step-by-step instructions Claude follows on every run;
   - `.claude/settings.json`, which lets the run read and write your tracker and run the script
     without asking you each time. It is a hidden folder, so make sure you copy it.
2. In `CLAUDE.md`, replace `<YOUR-TRACKER-URL>` with your tracker's link and delete the comment
   below it.
3. Start a Claude Code session on that repository and send: *"Run the price refresh described
   in CLAUDE.md."* The cloud environment probably blocks Yahoo Finance at first. Claude will then
   ask you to allow these hosts:
   - `query1.finance.yahoo.com`
   - `query2.finance.yahoo.com`
   - `fc.yahoo.com`
   - `financialmodelingprep.com` (only for logos)
4. Open your tracker. The header should now say **Prices as of** a recent date. Claude's summary
   lists any instrument it couldn't match under **NEEDS REVIEW**. Tell Claude the right Yahoo
   Finance symbol for it, and ask it to update that instrument in your tracker.
5. In the same session, set up the schedule: *"Set up a scheduled task that runs this price
   refresh every weekday at 7:10 in my time zone (Europe/Brussels). It should do only the steps
   in CLAUDE.md and change nothing else."* If you choose Tuesday to Saturday instead, Friday's
   closing prices arrive on Saturday rather than on Monday.

How the refresh matches instruments: it turns the broker's symbol, such as `EXRB:xnas`, into a
Yahoo Finance symbol using the exchange table `EXCH` in `refresh.py`. If that fails, it searches
Yahoo by ISIN and by name. It accepts a match only when the price on your trade date is within
4% of the price you paid.

The refresh has its own list of column names (the "instruments seen in imports" part of
`refresh.py`). If you add a column name to `COLS` in the page for the symbol, name, ISIN,
currency, type, exchange, date, price or description, add it in `refresh.py` too.

The script needs only Python 3. If the Pillow library is installed, it also adds logos. Yahoo
Finance's price service is free but unofficial, so it can change without notice.

## Tests

These tests are for people who change the code. They need [Node.js](https://nodejs.org) 18 or
newer and use only made-up data.

```bash
cd tests
```

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run fixture
```

```bash
npm test
```

`npm run fixture` writes a small, made-up Saxo-style export to `tests/fixtures/`. It has three
sheets, invented companies and an emptied column. `npm test` opens the page in a real browser,
with a fake database standing in for claude.ai's, and checks that:

- the page shows **Sign in to see your portfolio** without a database, including when opened as
  a file;
- an empty database shows the empty state and the import screen, and nothing is saved before an
  import;
- importing the made-up export stores all three sheets and leaves out the emptied column, which
  joins the never-import list;
- the transactions, dividends with their tax lines, positions, cash, the Performance and
  Dividends pages, and the phone layout all work;
- importing the same file again creates no duplicates;
- no outside server is contacted. The two libraries are answered from `node_modules`.

Screenshots go to `tests/out/`. To test your own broker's layout, add made-up rows in that
layout to `make-fake-export.js`. **Never commit your real export.**

To try the price refresh on the made-up import (this contacts Yahoo Finance and writes only to
local files):

```bash
DUMP_DIR=/tmp/ledger-dump npm test
```

```bash
echo '{}' > /tmp/ledger-versions.json
```

```bash
python3 -I ../refresh/refresh.py /tmp/ledger-dump /tmp/ledger-versions.json /tmp/ledger-out
```
