# Portfolio Ledger

A personal investment tracker for your Mac and iPhone. You import the Excel or CSV export of
your broker's transactions, and the app shows:

- your positions and cash;
- your returns compared with market indices;
- your dividends, with the tax withheld on each one;
- every transaction, which you can correct by hand.

It is an installable web app, hosted for free on GitHub Pages:

- **Your data stays on each device**, in the browser's own storage. Nothing about your
  portfolio is uploaded. Your Mac and iPhone don't sync: you copy your data from one to the
  other with a backup file.
- **Prices arrive every day at 6:53** (Belgian time). A GitHub Actions job in this repository
  fetches them from Yahoo Finance and publishes them as an **encrypted** file next to the app.
  Each device downloads the file and decrypts it with your passphrase.
- **The repository can be public.** It contains no personal data. The list of instruments the
  job fetches, and the passphrase, are GitHub *secrets*: encrypted, never shown again after you
  save them, and not readable from forks.

It was built around the **Saxo Bank** export, with Dutch or English column names. Other brokers
name their columns differently. Making the import understand your broker's file is usually a
small change, and Claude can make it for you (see [Adapting the import](#adapting-the-import-to-your-broker)).

This copy contains nobody's data. Your copy starts empty.

## What's in this repository

| File | What it is |
|---|---|
| `portfolio-ledger.html` | The app's page: everything you see, and the import. |
| `app/` | What makes it a standalone app: on-device storage, the encrypted prices download, backup, and the install files. |
| `.github/workflows/refresh.yml` | The daily job: fetches prices around 6:53 and publishes the app. |
| `refresh/` | The price refresh scripts. `standalone.py` is what the daily job runs; it uses `refresh.py`. |
| `tests/` | Browser tests, and a script that makes a small, made-up Saxo-style export (`.xlsx` and `.csv`) to test with. |
| `LICENSE` | The MIT license: you may use, change and share this code. |

## Set it up

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
7. Run the workflow once more (step 4). The app looks for new prices by itself, so a minute
   later the header shows **Prices** with today's date. You don't need to press anything.
8. On your other device: install the app (step 5), save the same passphrase, and copy your data
   across with **Download backup** on the first device and **Restore backup** on the second.
9. Create a GitHub token, so the app can start the daily job itself when GitHub's timer is
   late (in a new repository it often is, by hours):
   - On GitHub: your picture → **Settings → Developer settings → Personal access tokens →
     Fine-grained tokens → Generate new token**.
   - **Token name:** for example `Portfolio Ledger app`. **Expiration:** for example one year.
   - **Repository access:** **Only select repositories** → this repository.
   - **Permissions:** on the **Repositories** tab, click **+ Add permissions**, tick
     **Actions**, then change its level from Read-only to **Read and write**. GitHub adds
     **Metadata: Read-only** by itself. Add nothing else.
   - **Generate token** and copy it (it starts with `github_pat_`; GitHub shows it only once).
   - In the app on each device: **Transactions → This device → Prices**, paste it and click
     **Save token**.

   The token can only run, view or cancel this repository's Actions; it can't read or change
   your code or secrets. It is kept in the app's storage on the device.

## Your first import

1. Open the app. It says **No transactions yet**.
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

## Day to day

- **New export:** import it on each device, or import on one and move a backup to the other.
- **You bought something new, or changed a benchmark:** the Refresh list shows *changed since
  you last copied it*. Copy it into the `LEDGER_REFRESH_LIST` secret again. The new instrument
  gets its price at the next 6:53 run, or right away if you run the workflow by hand.
- **Backups:** your data exists only on your devices. Download a backup now and then, and keep
  it somewhere private. It holds your whole portfolio.
- **Prices from 6:53 missing?** GitHub's own timer is best effort and can start the job hours
  late. With a GitHub token saved (setup step 9), the app starts the job itself when it opens
  and finds no prices from the latest 6:53 run. The header says **Refreshing prices…**, and the
  new prices arrive about two minutes later.
- **Token expired?** The Prices box says GitHub refused the token. Create a new one (setup
  step 9) and save it on each device.
- **Prices arrive by themselves.** The app looks for a new prices file when it opens, when you
  come back to it (at most every 5 minutes), when the connection returns, and every 15 minutes
  while it is open. After the 6:53 run, open the app and the new prices are there.
- **Notes from the refresh:** if the job can't find an instrument on Yahoo Finance, the Prices
  box shows "The daily refresh has notes for you". To fix one by hand, add its Yahoo symbol to
  the refresh list text before you paste it, in `"hints":{"yahoo":{"<broker symbol>":"<Yahoo symbol>"}}`.
- **When the job fails**, GitHub emails you, and the app keeps the previous prices.

## What is and isn't private

- The refresh list holds, per instrument: symbol, name, ISIN, currency, type, exchange, and the
  date and price of one trade (used to check that the right Yahoo symbol was found). It also
  holds your benchmarks. It holds **no quantities, amounts or cash**.
- The job's public log shows only counts ("35 price series, 0 failed"), never names. The full
  report travels inside the encrypted file.
- The prices file is encrypted with AES-256-GCM; the key comes from your passphrase
  (PBKDF2-SHA256, 600,000 rounds). Its size still hints at how many price series it holds.
- The passphrase is kept in the app's storage on each device, so anyone who can use your
  unlocked device can open the app.

## Good to know

- GitHub pauses schedules in a repository with no activity for 60 days, and emails you first.
  Running the workflow by hand, or any commit, resets that.
- The job runs twice a day, at 4:53 and 5:53 UTC, so that one of the two is 6:53 in Belgium in
  both summer and winter. The other run is an hour earlier or later and does no harm. To change
  the time, edit the two `cron` lines in `.github/workflows/refresh.yml` (they are in UTC).
- GitHub's schedule is best effort: a run can start hours late or, rarely, be skipped. The
  next day's run catches up. To refresh right now, run the workflow by hand.
- You can host the app elsewhere: `python3 app/build.py out-folder` builds it, and any static
  https host works. The prices file must sit next to `index.html` as `prices.json.enc`.
- The app works offline once opened; it shows the last prices it downloaded.

## Adapting the import to your broker

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
> and run the tests in tests/.

Then commit and push the change to GitHub. The workflow publishes the new version within a few
minutes; close and reopen the app to load it.

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

## How the refresh finds your instruments

It turns the broker's symbol, such as `EXRB:xnas`, into a Yahoo Finance symbol using the
exchange table `EXCH` in `refresh/refresh.py`. If that fails, it searches Yahoo by ISIN and by
name. It accepts a match only when the price on your trade date is within 4% of the price you
paid. Logos come from financialmodelingprep.com.

The refresh has its own list of column names (the "instruments seen in imports" part of
`refresh.py`). If you add a column name to `COLS` in the page for the symbol, name, ISIN,
currency, type, exchange, date, price or description, add it in `refresh.py` too.

Yahoo Finance's price service is free but unofficial, so it can change without notice.

## Tests

These tests are for people who change the code. They need [Node.js](https://nodejs.org) 18 or
newer, Python 3 with the `cryptography` package, and use only made-up data.

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
npm run test:app
```

```bash
npm test
```

`npm run fixture` writes a small, made-up Saxo-style export to `tests/fixtures/`: three sheets,
invented companies and an emptied column, plus the main sheet as a semicolon CSV file with
day-month-year dates and amounts like `10.000,00`.

`npm run test:app` builds the app and opens it in a real browser. It checks on-device storage
across a reload, the refresh list (no amounts in it), a wrong and a right passphrase, prices
that arrive by themselves, starting the daily job when today's prices are missing (GitHub is
stood in for, nothing is sent), backup and restore on a second device, the install files and
opening the app offline.

`npm test` checks the page itself: the empty state, the `.xlsx` and `.csv` imports, the
never-import list, transactions, dividends and their tax lines, positions, cash, the
Performance and Dividends pages, re-importing without duplicates, and the phone layout.

Screenshots go to `tests/out/`. To test your own broker's layout, add made-up rows in that
layout to `make-fake-export.js`. **Never commit your real export.**

## License

MIT. See [LICENSE](LICENSE). You may use, change and share this code, including in your own
published copy.
