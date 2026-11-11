# Portfolio Ledger

A personal investment tracker. It runs in two ways: as a private page on claude.ai, or as a
[standalone web app](#standalone-app-for-mac-and-iphone-no-claudeai) that you install on your Mac
and iPhone, with your data stored only on the device. You import the Excel or
CSV export of your broker's transactions, and the page shows:

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
| `app/` | The standalone web app: on-device storage, encrypted prices download, backup, install files. |
| `.github/workflows/refresh.yml` | The standalone app's daily job: fetches prices at 6:53 and publishes the app. |
| `refresh/` | The price refresh script. `standalone.py` is what the daily job runs. `CLAUDE.md` is for the claude.ai version (optional). |
| `tests/` | A browser test, and a script that makes a small, made-up Saxo-style export (`.xlsx` and `.csv`) to test with. |
| `LICENSE` | The MIT license: you may use, change and share this code. |

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

If you set up the price refresh later, a third capability lets the page start it right after each
import (see [Start the refresh right after an import](#start-the-refresh-right-after-an-import)).
You don't need it to begin.

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
2. Click **Go to Transactions**, then **Import export**, and choose your broker's `.xlsx` or
   `.csv` file.
   You can also drop the file on the import area under **Imports & columns**.
3. The file is read in your browser, and only the columns it keeps are saved. A status line
   tells you which columns were left out.

Good to know:

- **Leaving out columns.** Before importing, you can empty any column you don't want stored,
  such as a user name or account number: delete the contents but keep the column title. The
  import leaves that column out and adds it to the **Never imported** list, so later files skip
  it too. Columns your broker always leaves empty are kept, and you can manage the list on the
  same screen. This works for Excel files only: a CSV file can't tell an emptied column from one
  the broker leaves empty, so a CSV import keeps every column. Put a column on the list yourself
  to leave it out of CSV files.
- **CSV files.** Fields may be separated by semicolons or commas, and the first line must hold
  the column titles. A CSV file has one table, which is read as the main list of transactions.
  Dates may look like `15-06-2026`, `15/06/2026` or `2026-06-15`, and amounts like `1.234,56` or
  `1,234.56`.
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

1. **The first row of every sheet (in a CSV file, the first line) must hold the column titles.**
   If your broker puts a title or a blank row above them, the import needs a small change in
   `readWorkbook` (around line 1947).
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
   where the broker itself wrote empty text or "-". `cellValue` (around line 1939) is where
   Excel cells, including dates, become values. A CSV file is read as text, so its dates and
   amounts are read by `day` and `num` in the core script.
5. **What kind of transaction a row is** comes from words in the description (around line 522):

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
   description, in the form "Koop 20 @ 100,00 USD" (`parseAction`, around line 467). A broker
   with Quantity and Price columns on the main sheet needs a small change in `buildEvents`
   (around line 505). The second example prompt above asks for exactly that.
7. **Dividend tax lines** are recognised in `dividendInfo` (around line 568): "Bronbelasting"
   or "withholding" is foreign tax, and "Roerende voorheffing" is the Belgian tax.
8. **The upload screen** (drop area, status line, the Never imported lists, the list of past
   imports) is built in `importPanelHTML` (around line 1857). The saving itself happens in
   `importFile` (around line 1964).

### Other things you may want to change

- **Number format.** Amounts are shown in Belgian Dutch style (`1.234,56`), set by
  `const LOC = 'nl-BE'`. Use for example `'en-GB'`, `'de-DE'` or `'fr-FR'` instead.
- **Currency.** The page assumes your account is in euro.
- **Tax.** Dividends show the Belgian tax on dividends (30%, `BE_RV`) and a table of foreign
  withholding tax rates by country (`WHT`). If you don't live in Belgium, ask Claude to change
  or remove this.

### Known limitations

- Numbers written as **text** (every number in a CSV file, and quantities in a description) use
  the last `.` or `,` as the decimal mark, so `1.234,56` and `1,234.56` both work. A number with
  one separator only, like `1.000` or `1,000`, is read as a decimal: 1. Real Excel numbers are
  not affected, and Saxo's Excel export uses those for its amounts.
- Dates written as text are read day first. A CSV file with month-first dates, like
  `06/15/2026`, needs a change in `day` in the core script.
- The Excel reader is SheetJS 0.18.5, loaded from cdnjs. It is the newest version cdnjs offers
  and has published security advisories, fixed in later versions that are only available from
  SheetJS's own site. Only import files you downloaded from your broker.

## Standalone app for Mac and iPhone (no claude.ai)

The same page also runs as an installable web app, hosted for free on GitHub Pages:

- **Your data stays on each device**, in the browser's own storage. Nothing about your
  portfolio is uploaded. Your Mac and iPhone don't sync: you copy your data from one to the
  other with a backup file.
- **Prices arrive every day at 6:53** (Belgian time). A GitHub Actions job in this repository
  fetches them from Yahoo Finance and publishes them as an **encrypted** file next to the app.
  Each device downloads the file and decrypts it with your passphrase.
- **The repository can be public.** It contains no personal data. The list of instruments the
  job fetches, and the passphrase, are GitHub *secrets*: encrypted, never shown again after you
  save them, and not readable from forks.

### Set it up

1. Fork this repository (or use your own copy). On the free GitHub plan it must be **public**
   for GitHub Pages to work.
2. In the repository on GitHub: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret**, twice:
   - `LEDGER_PASSPHRASE`: a passphrase you make up. Use several random words; anyone can download
     the encrypted file, so a short passphrase could be guessed.
   - `LEDGER_REFRESH_LIST`: for now, the text `{"v":1,"imports":{}}`. You replace it in step 6.
4. **Actions → Daily price refresh → Run workflow.** When it finishes, your app is at
   `https://<your-github-name>.github.io/<repository-name>/`.
5. Open that address in Safari.
   - **iPhone:** Share → **Add to Home Screen**.
   - **Mac:** File → **Add to Dock** (Safari 17 or newer). In Chrome: the install icon in the
     address bar.

   Open the app from its icon from then on. On iPhone this matters: Safari may delete the data
   of a website you haven't visited for a week, but not the data of an app on the Home Screen.
6. In the app, go to **Transactions** and import your broker's export. Then, in the **This
   device** panel:
   - type your passphrase and click **Save passphrase**;
   - click **Copy refresh list**, and paste it as the new value of the `LEDGER_REFRESH_LIST`
     secret on GitHub (Settings → Secrets and variables → Actions → the pencil next to it).
7. Run the workflow once more (step 4). A minute later, click **Check now** in the app: the
   header shows **Prices** with today's date.
8. On your other device: install the app (step 5), save the same passphrase, and copy your data
   across with **Download backup** on the first device and **Restore backup** on the second.

### Day to day

- **New export:** import it on each device, or import on one and move a backup to the other.
- **You bought something new, or changed a benchmark:** the Refresh list shows *changed since
  you last copied it*. Copy it into the `LEDGER_REFRESH_LIST` secret again. The new instrument
  gets its price at the next 6:53 run, or right away if you run the workflow by hand.
- **Backups:** your data exists only on your devices. Download a backup now and then, and keep
  it somewhere private. It holds your whole portfolio.
- **Notes from the refresh:** if the job can't find an instrument on Yahoo Finance, the Prices
  box shows "The daily refresh has notes for you". To fix one by hand, add its Yahoo symbol to
  the refresh list text before you paste it, in `"hints":{"yahoo":{"<broker symbol>":"<Yahoo symbol>"}}`.
- **When the job fails**, GitHub emails you, and the app keeps the previous prices.

### What is and isn't private

- The refresh list holds, per instrument: symbol, name, ISIN, currency, type, exchange, and the
  date and price of one trade (used to check that the right Yahoo symbol was found). It also
  holds your benchmarks. It holds **no quantities, amounts or cash**.
- The job's public log shows only counts ("35 price series, 0 failed"), never names. The full
  report travels inside the encrypted file.
- The prices file is encrypted with AES-256-GCM; the key comes from your passphrase
  (PBKDF2-SHA256, 600,000 rounds). Its size still hints at how many price series it holds.
- The passphrase is kept in the app's storage on each device, so anyone who can use your
  unlocked device can open the app.

### Good to know

- GitHub can start a scheduled run a few minutes late, sometimes more at busy times.
- GitHub pauses schedules in a repository with no activity for 60 days, and emails you first.
  Running the workflow by hand, or any commit, resets that.
- To change the time, edit `TIMEZONE`, `LOCAL_HOUR` and the two `cron` lines in
  `.github/workflows/refresh.yml`.
- You can host the app elsewhere: `python3 app/build.py out-folder` builds it, and any static
  https host works. The prices file must sit next to `index.html` as `prices.json.enc`.
- The app works offline once opened; it shows the last prices it downloaded.

## What's not included

- **No data.** None of the original owner's transactions, positions, settings or prices are
  included. Your database starts empty.
- **No price refresh.** The page doesn't fetch prices itself; a separate scheduled task does
  (see below). Until it runs, the header says **No prices yet**, positions are valued at what
  you paid for them, and the benchmark lines on the Performance page stay empty. Logos, sectors
  and countries also come from the refresh.

## Optional: a daily price refresh for the claude.ai version

This section is for the tracker published on claude.ai. The standalone app has its own daily job
(see above). The `refresh/` folder sets up a Claude Code session in the cloud that runs every weekday. It
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

### Start the refresh right after an import

Without this, a new instrument gets its price, logo and sector at the next scheduled run. With
it, the page starts your scheduled task itself right after each import, and the prices arrive
within a few minutes.

1. In a Claude Code session, send: *"Find my price refresh scheduled task and write its id to my
   tracker <your link>, in the document `settings/refresh`, field `trigger`."* The id looks like
   `trig_...`.
2. Republish the page with a third capability: the Claude Code Remote connector, limited to
   the one tool that starts a scheduled task. Send: *"Republish portfolio-ledger.html to my
   tracker <your link> with these capabilities:"* and paste:

   ```json
   {"db": {"rules": [{"path": "", "read": "view", "write": "admin"}]}, "user": {}, "mcp": {"servers": [{"server": "Claude Code Remote", "tools": ["fire_trigger"]}]}}
   ```

3. Import a file. The first time, claude.ai asks whether the page may use Claude Code Remote.
   Allow it. The header then says **Refreshing prices…** until the new prices arrive, for at
   most 30 minutes.

Good to know:

- **Only the owner starts it.** When an editor imports, prices follow at the next scheduled run.
- **What the page may do.** The connector lets the page start a scheduled task, and nothing
  else: it can't read, change or create scheduled tasks. The page starts only the task named
  in `settings/refresh`. Each start is one run of that task, like the daily one.
- **When it can't start.** The status line under the import says why (the connector isn't
  connected or allowed, or the task was deleted), and the prices follow at the next scheduled
  run. Your import is saved either way.
- **Prices during the day.** A run while a market is open stores that day's latest price. The
  next scheduled run replaces it with the closing price.

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
sheets, invented companies and an emptied column. The same main sheet is also written as a
semicolon CSV file, with day-month-year dates and amounts like `10.000,00`. `npm test` opens the page in a real browser,
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
- the CSV file gives the same transactions, positions and cash;
- with `settings/refresh` set, an import starts the scheduled task once, through a stand-in for
  the Claude Code Remote connector (nothing is sent), and the header says **Refreshing prices…**
  until the refresh has written new prices;
- the refresh is not started, and the status line says why, when the connector is missing, not
  allowed or not connected, or when the person importing is not the owner;
- no outside server is contacted. The two libraries are answered from `node_modules`.

`npm run test:app` does the same for the standalone app. It needs Python 3 with the
`cryptography` package. It checks on-device storage across a reload, the refresh list (no
amounts in it), a wrong and a right passphrase, backup and restore on a second device, the
install files and opening the app offline.

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

## License

MIT. See [LICENSE](LICENSE). You may use, change and share this code, including in your own
published copy.
