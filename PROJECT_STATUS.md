# Project status

Last updated: 2026-10-26 · Schema v1 · App version 1.0.0

Legend: ✅ done and verified · 🟡 done but limited / partially verified · ❌ not implemented ·
⛔ blocked in this environment · ⬜ planned

---

## 1. Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ clean |
| ESLint | `npm run lint` | ✅ 0 problems |
| Tests | `npm test` | ✅ **130 passed / 130**, 15 suites |
| Benchmark | `npm run test:bench` | ✅ 6 scenarios, numbers below |
| Android build | `./gradlew assembleDebug` | ⛔ **not run** — no JDK/Android SDK on this machine |

Benchmark dataset (real SQLite, real schema): 2,000 products, 40,000 sales, 120,000 sale lines,
25.8 MB database, ~19,000 inserted rows/s. Product first page 1.7 ms, 20th page 0.9 ms, English
search 2.4 ms, Urdu search 2.0 ms, barcode lookup 1.3 ms, sales page 1.1 ms, 30-day sales summary
13.7 ms, 30-day profit report 9.0 ms.

---

## 2. Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Repository, RN 0.88 TS project, Android project + Gradle wrapper, CI workflow | ✅ |
| 2 | Database foundation: schema v1, migrations, driver abstraction, seed, settings | ✅ |
| 3 | Inventory engine: micro units, packaging conversion, pricing, costing, stock movements | ✅ |
| 4 | Purchasing and suppliers, payments, ledgers | ✅ |
| 5 | POS and customers: cart, discounts, split/credit payments, invoices | ✅ |
| 6 | Returns, adjustments, restock, expenses, cash movements, cash closing | ✅ |
| 7 | Reports, CSV export, receipt layouts, printer bridge | 🟡 (no PDF export, no network printing) |
| 8 | PIN lock, recovery, roles, backup/restore and validation | 🟡 (no SQLCipher database encryption) |
| 9 | Urdu/English, RTL, performance work and measurement | ✅ |
| 10 | Final verification, APK, install test, offline test on device | ⛔ APK blocked here; device tests pending |

---

## 3. Feature status

### ✅ Implemented and covered by tests
- **Money and quantity arithmetic** — integer paisa + micro units, BigInt intermediate, half-away
  rounding, overflow guard. 30 unit tests (units, pricing, ledger, cart).
- **Unit and packaging engine** — one base unit per product, unlimited `product_units` rows,
  dimension checks (`kg ≠ litre`), explicit factor required across dimensions, mixed-unit entry:
  4 cartons + 10 boxes + 4 pieces = 544 pieces; 4 bags + 4 kg = 44 kg; 500 g = 0.5 kg.
- **Pricing** — derived packaging prices, manager overrides, rounding steps (paisa / rupee / 5
  rupees), margin vs markup labelling, frozen historical prices.
- **Costing** — weighted average cost, landed freight allocation, COGS frozen on each sale line.
- **Products** — create/edit/archive/restore, Urdu + English names, SKU/barcode/aliases, search
  over a normalized blob, categories, brands, suppliers, min/target stock, per-unit prices.
- **POS** — unit selection, decimal qty, line and bill discounts with limit + approval, tax (off by
  default), walk-in or customer, cash/digital/credit/partial/split payments, idempotent submit,
  stock movements, ledger, cash movement, receipt preview and reprint.
- **Purchases** — supplier + supplier invoice ref, mixed units, line discounts, freight, paid /
  partial / credit, payments against a purchase, purchase returns, reversals.
- **Khata ledgers** — running balances from document-backed entries, statements, opening balances,
  audited adjustments (no direct balance editing).
- **Returns / exchanges** — line-level partial returns, original-price refunds, restock vs damaged,
  COGS reversal, refund as cash or credit, exchange as return + new sale.
- **Stock adjustments / counts** — typed reasons, system vs counted quantities, cost input,
  immutable movements, negative stock blocked unless enabled.
- **Restock** — suggestions from min/target stock and history, supplier grouping, pre-filled
  purchase form.
- **Expenses** — categories, cash vs non-cash, audit, void instead of delete.
- **Cash** — drawer ledger tied to shifts, expected vs counted, difference recorded; digital
  payments excluded from drawer cash (tested).
- **Dashboard** — KPI cards and lists computed from database rows only (no sample data).
- **Reports** — sales, purchases, inventory, financial; date filters; CSV export (UTF-8 + BOM);
  reconciliation tests.
- **PIN security** — scrypt verifier in SecureStore, weak-PIN rejection, 5-attempt lockout with
  backoff, idle auto-lock, recovery questions (≥2, hashed, all-or-nothing verification).
- **Roles** — five roles, permissions enforced in services, tested denial paths.
- **Backup / restore** — VACUUM INTO snapshot, checksum + metadata, optional Keystore AES-GCM
  encryption, pre-restore integrity and version validation, post-restore check, reminder logic.
- **i18n** — English/Urdu dictionary with key-parity and RTL tests; receipts in either language.
- **Audit trail** — sensitive operations recorded with actor, entity and details.

### 🟡 Implemented with limits
- **Printing** — ESC/POS text and raster over Bluetooth plus Android share/print of a text receipt.
  Untested against physical printers here; no network-printing UI.
- **Urdu in thermal output** — depends on printer fonts; screen preview is correct.
- **Receipt layouts** — 58 mm (32 col) and 80 mm (42 col) text layouts; no graphical A4 invoice.
- **Dashboard** — date selection supported; per-store configuration limited to what Settings
  exposes.
- **Operators** — roles exist and are enforced; there is no operator CRUD screen (single operator
  per install, with a role switcher for permissions testing).
- **Batches / expiry** — the `products.track_expiry` flag exists, the workflow is not wired; the
  Help screen says so.

### ❌ Not implemented
- SQLCipher database encryption (file is plain SQLite in app-private storage).
- CSV **import** (products, parties, opening stock) and its preview/rollback UI.
- PDF export of reports and A4 invoices.
- Barcode *camera* scanning (keyboard-mode hardware scanners work; the POS search accepts the code
  and Enter).
- Multi-device sync, cloud backup, user accounts — deliberately out of scope for an offline app.
- Scheduled/automatic backups (reminder only).
- Batch/expiry tracking workflow.
- Biometric unlock, screenshot blocking.

### 🔁 Deliberate deviation from the requested stack
- **Zod and React Hook Form are not used.** They were installed, never adopted, and removed again
  rather than left as dead dependencies. Validation lives in the service layer with typed
  `ValidationError` field codes, re-checked inside the transaction. Rationale and consequences are
  in README.md §10; the rejection paths are covered by tests.

### ⛔ Blocked in this environment
- **APK generation.** No JDK, no Android SDK, no emulator here. The workflow in
  [.github/workflows/android.yml](.github/workflows/android.yml) is committed and is the intended
  path; it has not been executed (no push was made).
- **On-device verification** — install, launch, offline workflow, printer pairing, real keyboard
  behaviour. Requires a phone.
- **Kotlin compile check.** The native modules have not been compiled. Their method names were
  cross-checked against the TypeScript bridge by grep, but a compiler is the real test.

---

## 4. Test inventory (130 tests)

| Suite | Focus |
| --- | --- |
| `core/units` | conversions, mixed units, fractional quantities, cross-dimension rejection |
| `core/pricing` | derived prices, rounding steps, overrides, margin/markup, frozen history |
| `core/ledger` | running balances, sign convention, proportional allocation |
| `core/cart` | totals, merging, discounts, tax, negative clamping, client-ref rotation |
| `core/i18n` | key parity, RTL flag, Urdu normalization |
| `db/migration` | migration idempotency, schema version, FK enforcement, integrity check |
| `services/pos` | cash/credit/partial/split, stock deduction, rollback, duplicate submit, walk-in credit |
| `services/purchases` | mixed units, supplier debt, partial payments, cost update, purchase return |
| `services/returns` | partial/full returns, refunds, damage, COGS reversal, over-return rejection |
| `services/operations` | adjustments, expenses, cash closing, permission denials |
| `services/reports` | sales/profit/stock reports reconciling with ledgers |
| `services/receipt` | 58/80 mm layout, Urdu lines, duplicate marking |
| `services/security` | PIN verifier, salts, policy, recovery questions, lockout, change PIN |
| `services/backup` | snapshot, checksum, corrupt-file rejection, version guard, restore, role check |
| `ui/components` | shared components render (RNTL) |
| `perf/bench` | opt-in benchmark (skipped in the normal run) |

Not covered by automation: screen-level flows, Android native modules, printing, real-device
performance. These are listed as pending device verification, not as passing.

---

## 5. Known risks

1. **CI toolchain drift** — Gradle 9.4.1 / AGP 9 / `compileSdk 36` combinations must match what the
   runner installs. First workflow run may need a version nudge; BUILD_APK.md lists the exact
   packages.
2. **Native bridge is uncompiled** — a Kotlin signature mismatch would only surface at build/runtime.
3. **Unencrypted database** — the biggest security gap; documented in SECURITY.md §9.
4. **Printer compatibility** — ESC/POS is a de-facto standard, not a guarantee for every model.

## 6. Next steps (in order)

1. Push to GitHub, run the workflow, fix any Gradle/SDK issue, install the debug APK on a phone.
2. Walk the offline acceptance script on the device: PIN → product → purchase → mixed-unit sale →
   credit customer → payment → return → adjustment → expense → cash closing → report → backup →
   restore → reprint.
3. Add SQLCipher with a Keystore-wrapped key and a migration for existing plaintext files.
4. Add CSV import with preview/rollback, and PDF export for reports/invoices.
5. Add device-level integration tests (Detox or Maestro) for the POS and purchase flows.
