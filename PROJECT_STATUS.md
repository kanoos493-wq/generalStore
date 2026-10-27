# Project status

Last updated: 2026-10-27 · Schema v1 · App version 1.0.1 (versionCode 2)

Legend: ✅ done and verified · 🟡 done but limited / partially verified · ❌ not implemented ·
⛔ blocked in this environment · ⬜ planned

---

## 1. Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ clean |
| ESLint | `npm run lint` | ✅ 0 problems |
| Tests | `npm test` | ✅ **156 passed / 162**, 19 suites (6 skipped = opt-in benchmark) |
| Benchmark | `npm run test:bench` | ✅ 6 scenarios, numbers below |
| Android build | `./gradlew assembleDebug` | ⛔ **not run** — no JDK/Android SDK on this machine |

Benchmark dataset (real SQLite, real schema): 2,000 products, 40,000 sales, 120,000 sale lines,
25.8 MB database, ~19,000 inserted rows/s. Product first page 1.7 ms, 20th page 0.9 ms, English
search 2.4 ms, Urdu search 2.0 ms, barcode lookup 1.3 ms, sales page 1.1 ms, 30-day sales summary
13.7 ms, 30-day profit report 9.0 ms.

---

## 1b. First-run and PIN fixes (2026-10-27, v1.0.1)

Reported from a real install of the 1.0.0 debug APK: the app asked for a PIN on a *fresh*
installation, then for recovery questions in a chip-picker, then asked for the PIN a second time and
failed with **“crypto.getRandomValues must be defined”**.

| # | Root cause | Fix |
| --- | --- | --- |
| 1 | PIN salts came from `@noble/hashes` → `globalThis.crypto.getRandomValues`, which **does not exist in React Native**. Every PIN/recovery enrolment threw on a device (Node/Jest has Web Crypto, so tests never caught it). | New `src/core/random.ts`: platform Web Crypto when present, otherwise an entropy pool filled from Android `SecureRandom` through a new `SecureStore.randomHex()` Kotlin method (`src/native/bridge.ts`). No `Math.random` fallback on a device; the failure is reported in the UI. Pool primed in `appStore.initialize()` before any PIN work. |
| 2 | First launch showed the **lock screen's setup mode** (PIN keypad) because `locked` started `true` and “needs setup” was inferred from “PIN enabled but missing”. | New `SetupWizardScreen`: welcome + language → shop profile → owner → optional PIN + recovery → review. `setup_completed` (new setting, default `'0'`, so existing installs get the wizard once) drives the gate; `locked` is now `setupComplete && hasPin`. A PIN is optional — with none, the app never locks. |
| 3 | Recovery questions were chip buttons with no real picker, and finishing them re-asked for the PIN. | Recovery enrolment uses the shared `SelectField` dropdown in both the wizard and Security; `PinManager.setRecovery()` writes the questions without touching the PIN verifier, so nothing asks for the PIN twice. Security settings also gained **Set / Change / Turn off PIN**. |
| 4 | Hardcoded `secureStorage.setItem('pin_record_v1', …)` in the Security screen bypassed `PinManager` and could write a record without a matching policy check. | Replaced with `PinManager.setRecovery()` / `disablePin()`; tests assert the verifier and salt are untouched by recovery enrolment. |

Verified locally: `npm run typecheck` clean, `npm run lint` 0 problems, `npm test` 156 passed
(19 suites). New coverage: `__tests__/ui/setup-flow.test.tsx` (wizard end-to-end on a real SQLite
file, PIN created once, no second prompt, no store name ⇒ cannot continue),
`__tests__/core/random.test.ts` (incl. PIN creation with Web Crypto hidden = the on-device path) and
`__tests__/services/onboarding.test.ts` (fresh DB ⇒ not set up; empty-shop dashboard/reports do not
invent numbers).

**Still not verified here:** the Kotlin `randomHex` method has not been compiled (no JDK/SDK on this
machine) and the fixed APK has not been installed. Both are pending the GitHub Actions build and a
phone install.

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

### ✅ Layout safety and branding (new since the first pass)
- **System bars & insets** — `Screen`, `BottomBar`, the bottom tab bar and every absolute FAB/footer
  read `useSafeAreaInsets()`; the tab bar grows by the navigation-bar height so gesture and
  three-button modes both keep labels clear. POS (header hidden) pads its own top bar.
- **Keyboard** — `adjustResize` in the manifest, `keyboardShouldPersistTaps="handled"` plus
  `keyboardDismissMode="on-drag"` on every scroll surface, scrollable modal sheets with an
  inset-aware bottom, `decimal-pad`/`number-pad` keyboards on money, quantity and PIN fields.
  PIN entry uses the app's own keypad, so no OS keyboard covers it.
- **Branding** — official name **DukanDost**, editable vector logo, generated launcher PNGs for all
  five densities, adaptive + monochrome icons, API 24–30 and API 31+ splash themes, in-app brand
  mark on Lock and About, and shared design tokens incl. `motion`. See BRANDING.md.
- **Reduced motion** — `useReducedMotion()` (AccessibilityInfo) gates sheet animation.
- **Tests** — `__tests__/ui/layout.test.tsx` asserts the inset contract and brand-mark basics.
  Current totals: **156 passing / 162**, 19 suites.

### ✅ APK built in GitHub Actions (verified)

| Item | Result |
| --- | --- |
| Workflow | [`.github/workflows/android.yml`](.github/workflows/android.yml) — 3 jobs |
| Run | `40361107093` on commit `1ffc58b`, `main`, all jobs green |
| verify job | `npm ci` → typecheck → ESLint → Jest, all passing on the runner (independent of this machine) |
| apk job | `./gradlew assembleDebug assembleRelease` → `general-store-debug-apk` (46.25 MB), `general-store-release-apk` (26.91 MB) |
| Bundle check | the workflow fails if either APK lacks `assets/index.android.bundle`; both passed |
| Inspected locally | `assets/index.android.bundle` present and Hermes bytecode (`c6 1f bc 03`), 4 ABIs, adaptive + 5-density launcher icons, `DukanDost` label and `Theme.GeneralStore.Starting` in `resources.arsc`, brand teal `#0F766E` |

Fixed on the way there, each a real failure rather than a guess: `secrets` used inside `if:` made
GitHub reject the whole workflow file (0 jobs); `android-actions/setup-android@v3` calls the removed
`sdkmanager tools` package; `platforms;android-37` / `cmake;3.22.1` are no longer published (API 37
ships as `android-37.0`); and two Kotlin modules read `currentActivity` off the module instead of
the React context.

**Still unverified:** the APK has not been installed or launched on hardware. Every device-facing
claim in §7 below stays untested until someone sideloads `general-store-debug-apk`.

### 🔁 Deliberate deviation from the requested stack
- **Zod and React Hook Form are not used.** They were installed, never adopted, and removed again
  rather than left as dead dependencies. Validation lives in the service layer with typed
  `ValidationError` field codes, re-checked inside the transaction. Rationale and consequences are
  in README.md §10; the rejection paths are covered by tests.

### ⛔ Blocked in this environment
- **Building on this machine.** No JDK, no Android SDK, no emulator here, so `./gradlew` cannot run
  locally. The APK comes from [.github/workflows/android.yml](.github/workflows/android.yml) on
  GitHub's runners, which has built and uploaded the artifacts successfully (see below).
- **On-device verification** — install, launch, offline workflow, printer pairing, real keyboard
  behaviour, and the 1.0.1 first-run wizard. Requires a phone; the owner's phone run is what
  produced the 1.0.0 bug report.
- **Kotlin compile check.** The native modules have never been compiled on this machine. They do
  compile on CI (the `apk` job is green), but the newest addition — `SecureStore.randomHex()` — was
  written after the last green run and is waiting for its first CI compile.

---

## 4. Test inventory (162 tests, 19 suites)

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
| `core/random` | byte count, salt uniqueness, hex round-trip + malformed hex rejection, native entropy pool, fail-loud with no source, **PIN creation with Web Crypto hidden** (the on-device path) |
| `services/security` | PIN verifier, salts, policy, recovery questions, lockout, change PIN, recovery enrolment that leaves the verifier untouched, turning the PIN off |
| `services/onboarding` | fresh database reports “not set up”, wizard result persists, Urdu store name round-trip, empty-shop dashboard/reports (no invented numbers, no NaN) |
| `ui/setup-flow` | first render is the wizard (never a PIN prompt), full walkthrough without a PIN, PIN created once with recovery answers, store name required |
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

## 7. Device-configuration acceptance matrix (NOT yet run)

Nothing in this table has been executed — no Android device or emulator exists in this
environment. Record the real device, Android version and navigation mode against each row when it
is performed.

| # | Configuration / scenario | Status |
| --- | --- | --- |
| 1 | Small phone in portrait (≤ 5.5″, 720p) | ⬜ untested |
| 2 | Typical phone, gesture navigation | ⬜ untested |
| 3 | Three-button navigation | ⬜ untested |
| 4 | Device with cutout / punch-hole camera | ⬜ untested |
| 5 | Increased display size and/or font scale at max | ⬜ untested |
| 6 | English LTR / Urdu RTL switch without layout break | ⬜ unit-tested (i18n), ⬜ not device-tested |
| 7 | Form with keyboard open, last field focused, Save reachable | ⬜ untested |
| 8 | POS payment sheet with keyboard open; cart preserved | ⬜ untested |
| 9 | Long product list + long menu scrolling | ⬜ partially covered by the keyset benchmark, ⬜ not device-tested |
| 10 | Modal/sheet displayed while the keyboard is visible | ⬜ untested |
| 11 | Background → foreground with an unfinished sale (auto-lock) | ⬜ untested |
| 12 | Launcher icon on home screen (adaptive mask + themed icon) | ⬜ untested |
| 13 | Native splash → first frame, empty DB and existing DB | ⬜ untested |
| 14 | Startup failure shows a retry screen, not an endless spinner | ✅ code path exists (`bootError`), ⬜ not device-tested |
| 15 | Landscape orientation | ⬜ untested (portrait assumed) |
| 16 | Light/dark system theme | 🟡 app is light-only; `DayNight` parent resolves to light |

---

## 8. Next steps (in order)

1. ~~Push, run the workflow, fix the Gradle/SDK issues~~ — done, see the APK section above. Remaining:
   download `general-store-debug-apk` and install it on a phone.
2. Walk the offline acceptance script on the device: PIN → product → purchase → mixed-unit sale →
   credit customer → payment → return → adjustment → expense → cash closing → report → backup →
   restore → reprint.
3. Add SQLCipher with a Keystore-wrapped key and a migration for existing plaintext files.
4. Add CSV import with preview/rollback, and PDF export for reports/invoices.
5. Add device-level integration tests (Detox or Maestro) for the POS and purchase flows.
