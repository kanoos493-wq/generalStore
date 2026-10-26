# General Store — Offline POS & Inventory for Pakistani shops

A complete, offline-first Android application (React Native + TypeScript) for a general
store / kiryana store / mini-mart in Pakistan: products with Urdu names, a mixed-unit
packaging engine, POS with credit and split payments, purchases, supplier and customer
khata ledgers, stock adjustments, expenses, cash closing, reports, backup/restore and PIN
security.

Everything runs on the device. There is no server, no cloud database, no analytics, no
advertising SDK and **no `INTERNET` permission** in the Android manifest.

---

## 1. Status at a glance

| Area | State |
| --- | --- |
| TypeScript typecheck (`npm run typecheck`) | ✅ clean |
| ESLint (`npm run lint`) | ✅ clean, 0 problems |
| Automated tests (`npm test`) | ✅ 135 passing / 16 suites (business logic, SQLite integration, layout, components) |
| Performance benchmark (`npm run test:bench`) | ✅ measured on a synthetic 2,000 products / 40,000 sales dataset (see §7) |
| Android APK | ⚠️ **not built on this machine** — no JDK/Android SDK here. The GitHub Actions workflow builds it; see [BUILD_APK.md](BUILD_APK.md) |
| Database encryption (SQLCipher) | ❌ **not implemented**. The database file is plain SQLite protected by the PIN gate and app-private storage. See [SECURITY.md](SECURITY.md) |

<sub>`PROJECT_STATUS.md` contains the full, honest item-by-item status.</sub>

---

## 2. What the app does

### Inventory engine (the core requirement)
- Every product has **one base stock unit** and any number of **purchase/sale units** with
  their own conversion factors (bag, carton, box, dozen, kg, g, litre, ml, packet, tin…).
- Quantities are stored as **integer micro base units** (1 kg = 1,000,000 micro), money as
  **integer paisa**. No binary floating point touches stock or money.
- Mixed-unit entry everywhere: `4 cartons + 10 boxes + 4 pieces` = 544 pieces saved as one
  purchase line group; `4 bags + 4 kg` = 44 kg; `500 g` = 0.5 kg.
- Derived selling prices per packaging unit from the base price, with explicit rounding and
  optional manager override; historical transaction prices are never rewritten.
- Weighted-average costing with the cost frozen on each sale line, so profit history is stable.
- Every stock change writes an immutable `stock_movements` row; negative stock is blocked
  unless the manager enables it in Settings.

### Selling
- Touch POS with one-tap product search (English + Urdu + SKU + barcode), unit picker,
  decimal quantities, line and cart discounts (percentage or fixed), tax (off by default).
- Walk-in sales, registered customers, credit sales against a credit limit, partial and split
  payments across configurable methods (cash, bank transfer, card, wallet, Raast, custom).
- Idempotent sale creation (`client_ref`) so a double tap or retry never creates two invoices.
- Receipt preview for 58 mm / 80 mm thermal printers, reprint marked as `DUPLICATE`.
- Returns and exchanges linked to the original invoice line — the original is reversed, never
  deleted.

### Buying and ledgers
- Purchases in mixed units with freight/other charges distributed to line cost, supplier
  invoice reference, paid/partial/credit, multiple payments per purchase.
- Supplier and customer **khata** ledgers built from document-backed entries with running
  balances (never a manually edited balance field), statements and exports.
- Stock adjustments, physical stock counts with system-vs-counted differences, wastage and
  found-stock reasons — each requires a reason and is audited.

### Day-to-day operations
- Dashboard KPIs computed from real rows (sales, cash, digital, credit, receivables, payables,
  profit estimate, stock value at WAC, low/out-of-stock, drawer cash, last closing).
- Restock suggestions grouped by supplier → draft purchase in one tap.
- Expenses with categories and cash/non-cash distinction; cash drawer ledger and cash closing
  with expected vs counted difference.
- Reports (sales, purchases, inventory, financial) with date filters, CSV export and printable
  views; keyset-paginated lists that never load a whole table into memory.

### Security and safety
- PIN set on first launch, scrypt verifier (N=32768, r=8, p=1) with per-device salt, increasing
  lockout on failed attempts, auto-lock on inactivity and on backgrounding.
- Multi-question recovery with hashed, normalized answers; a forgotten PIN can be reset from those answers without erasing data.
- Role-based permissions (owner / manager / cashier / inventory / accountant) enforced in the
  service layer, with an audit trail for sensitive operations.
- Backup = consistent SQLite snapshot, checksummed, recorded, optionally AES-GCM encrypted with
  an Android Keystore key; restore validates integrity and schema version **before** replacing
  anything.

### Language
- Full English and Urdu UI, RTL layout, per-string translations (`src/app/strings.ts`), Urdu text normalization for search, and receipts in either or both languages.

---

## 3. Technology

| Concern | Choice |
| --- | --- |
| Framework | React Native **0.88** + TypeScript 5.8, React 19 |
| Android | Community CLI project committed (`android/`), Gradle **9.4.1** wrapper, AGP 9.x, Kotlin 2.2, `compileSdk 36`, `minSdk 24`, `targetSdk 36`, NDK 27.1.12297006 |
| Database | SQLite through a native Kotlin bridge (`SqliteBridge`) with prepared statements, transactions, `VACUUM INTO` backups and integrity checks |
| State | Zustand (app/session/cart stores) |
| Forms | Controlled inputs + shared validators that throw typed `ValidationError`s (see §10) |
| Navigation | React Navigation 7 (bottom tabs + native stack) |
| Secrets | Android Keystore (AES-GCM) via `SecureStore` native module |
| Printing | Native `PrinterBridge` (Bluetooth ESC/POS text and raster) |
| Tests | Jest 29 + `@testing-library/react-native` 13, real SQLite via `node:sqlite` |
| CI | GitHub Actions (`.github/workflows/android.yml`) |

### Why a native SQLite bridge instead of a JS SQLite package
The bridge uses Android's own SQLite (`SQLiteDatabase`) so the app ships **zero** extra native
binaries, starts fast on budget phones, and can run `PRAGMA integrity_check`, `VACUUM INTO`
backups and file-level restore directly. The JS side only ever calls prepared statements
(`exec`, `query`) through one serialized connection (`src/db/driver.ts` → `src/native/bridge.ts`).

---

## 4. Repository layout

```
src/
  core/        pure business logic — money, units, pricing, costing, ledger, dates, ids, text, permissions
  db/          schema + migrations, driver abstraction, node driver (tests), seed, row types
  services/    products, sales/POS, purchases, payments, returns, adjustments, cash, expenses,
               reports, dashboard, numbering, audit, PIN, receipts, backup
  native/      typed bridge to the Kotlin modules (SQLite, SecureStore, Printer)
  app/         theme, i18n, formatting, stores, components, 27 screens, navigation
android/       Gradle project + Kotlin modules (SqliteBridge, SecureStore, PrinterBridge)
__tests__/     core/ (units, pricing, ledger, cart, i18n), db/, services/, ui/, perf/
scripts/       helper checks used during development
.github/       android.yml — verify + debug APK + optional signed release APK
```

**Rule of the codebase:** screens never write SQL. They call services; services validate with
Zod + permissions and run inside a single database transaction.

---

## 5. Running it

```bash
npm ci                 # install (Node >= 22.11)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # 130 tests, no device needed
npm run test:bench     # opt-in performance benchmark
```

For a device build you need a JDK 17 and the Android SDK (or just use
[BUILD_APK.md](BUILD_APK.md) and GitHub Actions — Android Studio is **not** required):

```bash
npx react-native start          # Metro
npm run android                 # install debug build on a connected phone
# or, without Metro:
npm run android:assemble        # android/app/build/outputs/apk/debug/app-debug.apk
```

First launch asks the manager to set a PIN (min 4 digits), then opens the dashboard. Sample
units, payment methods and expense categories are seeded automatically; no products are
pre-loaded, so nothing in the dashboard is faked.

---

## 6. Tests

```
PASS core __tests__/core/units.test.ts        conversions, mixed units, cross-dimension rejection
PASS core __tests__/core/pricing.test.ts      derived prices, overrides, rounding, history
PASS core __tests__/core/ledger.test.ts       running balances, sign conventions
PASS core __tests__/core/cart.test.ts         POS cart totals, merge, discounts, tax, dedupe ref
PASS core __tests__/core/i18n.test.ts         en/ur key parity, RTL flags, Urdu normalization
PASS core __tests__/db/migration.test.ts      migrations, version, integrity, FK enforcement
PASS core __tests__/services/pos.test.ts      cash/credit/partial/split, stock, rollback, duplicates
PASS core __tests__/services/purchases.test.ts mixed units, supplier debt, partial payments, returns
PASS core __tests__/services/returns.test.ts  full/partial returns, refunds, stock restoration
PASS core __tests__/services/operations.test.ts adjustments, expenses, cash closing, permissions
PASS core __tests__/services/reports.test.ts  sales/profit/stock reports reconcile with ledgers
PASS core __tests__/services/receipt.test.ts  receipt layouts, Urdu lines, reprint marking
PASS core __tests__/services/security.test.ts PIN, lockout, recovery answers, recovery code
PASS core __tests__/services/backup.test.ts   snapshot, checksum, precheck, version guard, restore
PASS ui   __tests__/ui/layout.test.tsx        system-bar insets, bottom bar, brand mark
PASS ui   __tests__/ui/components.test.tsx    shared components render
Tests: 135 passed, 135 total
```

The database tests are **not mocks**: they open a real SQLite file with `node:sqlite`, run the
real migrations and call the real services.

---

## 7. Performance (measured, not estimated)

`npm run test:bench` builds a synthetic dataset with the real schema and times the queries the
app runs. Result on the development machine (Windows, Node 24, `node:sqlite`):

| Measurement | Value |
| --- | --- |
| Dataset | 2,000 products · 40,000 sales · 120,000 sale lines · 25.8 MB database |
| Bulk insert throughput | ~19,000 rows/s |
| First product page (40 rows) | 1.7 ms |
| 20th product page, keyset cursor | 0.9 ms |
| English name search | 2.4 ms |
| Urdu name search | 2.0 ms |
| Barcode lookup | 1.3 ms |
| Sales history page (40 rows) | 1.1 ms |
| Next sales page (keyset) | 1.1 ms |
| 30-day sales summary | 13.7 ms |
| 30-day profit report | 9.0 ms |

Deep paging stays flat because lists use **(value, id) keyset cursors**, not `OFFSET`.
Phone numbers will be slower than this laptop, but the shape holds: pages are index seeks, and
the aggregates are the only queries that scan a month of rows.

Scaling plan and limits: see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) §8.

---

## 8. Documentation map

- [DATABASE_DESIGN.md](DATABASE_DESIGN.md) — tables, relationships, indexes, money/quantity
  representation, migrations, transaction and pagination rules.
- [ACCOUNTING_RULES.md](ACCOUNTING_RULES.md) — stock valuation, COGS, profit, returns, ledger
  signs, cash reconciliation, rounding.
- [SECURITY.md](SECURITY.md) — PIN, lockout, recovery, Keystore, backup encryption, role matrix
  and the honest limits of on-device security (including what is *not* encrypted yet).
- [BRANDING.md](BRANDING.md) — **DukanDost** identity: logo source, generated launcher icons,
  adaptive/monochrome icon, splash themes, palette and motion tokens.
- [BUILD_APK.md](BUILD_APK.md) — GitHub Actions workflow, artifact names, signing secrets,
  toolchain versions, troubleshooting.
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — what is done, what is partial, what is untested.

---

## 9. Known limitations (read this)

1. **No APK has been produced in this environment.** There is no JDK or Android SDK on this
   machine, so `assembleDebug` cannot run here. The workflow is committed and self-contained;
   the first push to GitHub is what actually produces `general-store-debug-apk`.
2. **The SQLite file is not encrypted with SQLCipher.** Encryption is limited to backups
   (AES-GCM, Keystore key) and the PIN gate. A rooted device can read the database file.
   See SECURITY.md for the plan and the guarantees that *do* exist.
3. **Single device, single store.** The schema carries `created_by`/roles and is ready for
   multi-operator use, but there is no multi-device sync — by design, this is an offline app.
4. **Printer support is ESC/POS over Bluetooth (and text share/PDF preview).** Not every
   printer model is tested; there is no network printing UI yet.
5. **Screens are not covered by automated UI tests.** Business rules, SQL and shared
   components are tested; per-screen interaction flows are verified manually on a device.
6. **Thermal receipt Urdu shaping** relies on the printer's own font; Urdu receipt preview is
   correct on screen, but some cheap printers have no Nastaliq glyphs.
7. **No PDF export yet.** Reports export to UTF-8 CSV (Excel-compatible) and print via the
   Android print/share sheet; a native PDF renderer is still to be added.

---

## 10. Deviations from the requested stack (and why)

The brief named React Hook Form + Zod for forms. Both packages were installed and then **removed
before release** because they were never used: forms are plain controlled inputs, and validation
lives in the services, which is where it has to be anyway (a schema in the screen protects nothing
when a service is called from another path).

What replaced them:

- Every service validates its own input and throws a typed error with a stable field code
  (`ValidationError(message, 'discount')`, `PermissionError`, `NotFoundError`), which the screens
  render inline next to the field. The same rules are re-checked inside the database transaction,
  so a stale screen cannot write an invalid document.
- Cross-field rules that a schema library cannot express (credit limit, discount approval, stock
  availability, over-return, negative stock policy) stay in the service next to the data they
  need.
- Tests assert the rejections (`pos`, `purchases`, `returns`, `operations`, `security` suites), which
  is stronger than asserting a schema parses.

The rest of the stack is as specified: React Native Community CLI + TypeScript + native Android
project + Gradle wrapper, SQLite with prepared statements and transactions, Zustand, React
Navigation, Android Keystore secure storage, native Bluetooth printing, Jest + RNTL, GitHub Actions.
