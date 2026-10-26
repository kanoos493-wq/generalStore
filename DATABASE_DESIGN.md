# Database design

SQLite database `generalstore.db` in the app's private storage, accessed through the native
`SqliteBridge` module (`android/app/src/main/java/com/generalstore/nativebridge/SqliteBridgeModule.kt`).
The schema lives in [src/db/schema.ts](src/db/schema.ts) as versioned migration statements.

Connection pragmas (set on every open, `src/db/database.ts`):

```sql
PRAGMA journal_mode = WAL;      -- concurrent reads, crash-safe writes
PRAGMA synchronous = NORMAL;    -- balanced durability for a shop phone
PRAGMA foreign_keys = ON;       -- referential integrity is enforced, not decorative
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -8000;      -- ~8 MB page cache, bounded for budget devices
```

---

## 1. Value representation (the rule everything else follows)

| Concept | Storage | Example |
| --- | --- | --- |
| Money | `INTEGER` paisa (1 PKR = 100) | PKR 1,500.00 → `150000` |
| Quantity | `INTEGER` micro base units (1 unit = 1,000,000) | 500 g (0.5 kg) → `500000` |
| Conversion factor | `INTEGER` micro units per 1 of that unit | 1 bag = 10 kg → `10000000` |
| Rates (tax, discount) | `INTEGER` basis points | 17% → `1700` |
| Timestamps | `TEXT` ISO-8601 UTC | `2026-10-26T09:31:07.412Z` |
| Identifiers | `TEXT` time-ordered ids | `sale_1k9c2x_7f3a` |

No `REAL` column exists anywhere in the schema. All arithmetic goes through
[src/core/money.ts](src/core/money.ts) which uses `BigInt` and rounds half away from zero, then
guards the result against `Number.MAX_SAFE_INTEGER` (an overflow throws instead of corrupting a
total).

Why micro units: 0.001 kg precision is not enough for a shop that sells 100 g of spice, and
decimal quantity entry (`1.25 kg`, `2.5 bags`) must be exact. 6 decimals covers every realistic
retail quantity while staying inside signed 64-bit integers for stock in the millions of units.

---

## 2. Tables

### Configuration and reference data
| Table | Purpose | Key columns |
| --- | --- | --- |
| `settings` | Key/value store for store profile, numbering, policy, language, backup reminder | `key` (PK), `value` |
| `units` | Unit catalogue seeded from `BUILTIN_UNITS`; custom units are inserted here | `code` (PK), `dimension`, `canonical_micro`, `builtin` |
| `categories`, `brands` | Simple taxonomies for products | `id`, `name_en`, `name_ur` |
| `payment_methods` | Cash / bank / card / wallet / credit, `is_cash` and `is_credit` drive accounting | `id`, `is_cash`, `is_credit` |
| `sequences` | Atomic document counters (`sale`, `purchase`, `return`, `adjustment`, `expense`) | `key` (PK), `next_value` |

### Products and stock
| Table | Purpose | Notes |
| --- | --- | --- |
| `products` | One row per item, **one base unit** | `base_unit` → `units.code`; `stock_micro` and `cost_paisa` are caches of the movement ledger; `search_blob` is a normalized `name_en + name_ur + code + brand` string for search |
| `product_barcodes` | Extra barcodes per product | unique `barcode` |
| `product_units` | Purchase/sale units with explicit factors | `kind` = `purchase` \| `sale`, `factor_micro`, optional `price_paisa` override, `is_default` |
| `stock_movements` | **Immutable** stock history | `qty_micro` (delta, canonical), `entered_qty_micro` + `unit_code` + `factor_micro` (what the user typed), `unit_cost_paisa`, `balance_after_micro`, `doc_type`/`doc_id`/`doc_no`, `reason`, `reversal_of` |

`stock_movements` is the audit spine: `products.stock_micro` must always equal
`SUM(stock_movements.qty_micro)` for that product, and the test suite asserts exactly that.

### Buying
| Table | Purpose |
| --- | --- |
| `purchases` | Document header: `doc_no`, supplier, `ref_no` (supplier invoice), dates, `subtotal/discount/freight/tax/total/paid`, `status`, `client_ref` for idempotency, reversal columns |
| `purchase_lines` | One row per entered line: original `unit_code`/`qty_micro`/`factor_micro`, canonical `base_qty_micro`, `unit_cost_paisa`, `cost_per_base_paisa` |

Setting a price by bag and stock by kg is therefore lossless: the line keeps what the operator
typed *and* the canonical quantity and cost.

### Selling
| Table | Purpose |
| --- | --- |
| `sales` | Header: `invoice_no` (unique), customer (nullable = walk-in), `sold_at`, totals, `paid_paisa`, `credit_paisa`, `status`, `shift_id`, `client_ref` |
| `sale_lines` | `product_name` snapshot, entered unit/qty/factor, `base_qty_micro`, `unit_price_paisa`, `line_discount_paisa`, `line_total_paisa`, `unit_cost_paisa` and `cogs_paisa` **frozen at sale time**, `returned_qty_micro` |

Prices and costs are copied onto the line, so changing a product price tomorrow never rewrites
last month's invoice or profit.

### Money movement
| Table | Purpose |
| --- | --- |
| `payments` | Money in/out against a document or a party, with method and direction; `is_void` instead of deletion |
| `ledger_entries` | Customer/supplier khata: `debit_paisa`, `credit_paisa`, running `balance_paisa`, source `doc_type`/`doc_id` |
| `cash_movements` | Physical drawer movement (`in`/`out`) tied to a `shift_id`, with `source_type`/`source_id` pointing at the sale, payment, expense or adjustment |
| `shifts` | Cash session: `opening_cash_paisa`, `expected_cash_paisa`, `counted_cash_paisa`, `difference_paisa`, `status` |

### Corrections and operations
| Table | Purpose |
| --- | --- |
| `returns` / `return_lines` | Customer (`sale`) and supplier (`purchase`) returns; `restock` flag and `damage_qty_micro` keep unsellable goods out of stock |
| `adjustments` / `adjustment_lines` | Stock receipts, opening stock, count corrections, wastage, found stock; `system_qty_micro` and `counted_qty_micro` record a physical count |
| `expenses` / `expense_categories` | Operating expenses, `is_cash` decides drawer impact |
| `audit_events` | Who did what: `actor`, `action`, `entity`, `entity_id`, JSON `details` |
| `backups` | Backup metadata: path, size, `encrypted`, `schema_version`, `checksum`, `status` |

---

## 3. Relationships

```
units ─┬─ products.base_unit
       └─ product_units.unit_code
categories / brands ── products
suppliers ── products.supplier_id, purchases, ledger_entries(party_type='supplier')
customers ── sales, ledger_entries(party_type='customer')

products ── product_barcodes, product_units, stock_movements,
            purchase_lines, sale_lines, adjustment_lines, return_lines

purchases ── purchase_lines
sales     ── sale_lines
returns   ── return_lines ── sale_lines / purchase_lines
adjustments ── adjustment_lines

payments ─(doc_type, doc_id)→ purchases | sales | returns | (party only)
ledger_entries ─(doc_type, doc_id)→ sales | purchases | payments | returns | adjustments
stock_movements ─(doc_type, doc_id)→ sales | purchases | returns | adjustments
cash_movements ─(source_type, source_id)→ sales | payments | returns | expenses | manual
```

`(doc_type, doc_id)` pairs are used instead of a dozen nullable foreign keys on shared history
tables: a movement row can point at any document type without schema churn, and each service
resolves the exact document it wrote. Foreign keys are enforced on the owning columns
(`sale_id`, `product_id`, `purchase_id`, …) where cascade behaviour matters.

---

## 4. Indexes (39 in schema v1)

Indexes exist to serve real queries, not for decoration:

| Index | Serves |
| --- | --- |
| `idx_products_active_name (is_active, name_en)` | product list ordered by name |
| `idx_products_archived`, `idx_products_category`, `idx_products_stock` | archive filter, category filter, low/out-of-stock filters |
| `idx_products_search (search_blob)`, `idx_customers_search`, `idx_suppliers_search` | prefix search over the normalized blob (English + Urdu + code) |
| `idx_product_units_product (product_id, kind)` | unit picker in POS and purchase forms |
| `idx_sales_date`, `idx_sales_customer`, `idx_sales_status` | history list, customer statement, status filters |
| `idx_sale_lines_sale`, `idx_sale_lines_product` | invoice detail, product sales history |
| `idx_purchases_date`, `idx_purchases_supplier`, `idx_purchase_lines_purchase` | purchase list, supplier statement, purchase detail |
| `idx_stock_moves_product_date`, `idx_stock_moves_date`, `idx_stock_moves_doc` | product movement history, stock reports, reversal lookups |
| `idx_ledger_party_date`, `idx_ledger_doc` | khata statements and reconciliation |
| `idx_payments_party`, `idx_payments_doc`, `idx_payments_date` | party statement, document payments, daily cash by method |
| `idx_expenses_date`, `idx_expenses_category` | expense list and category report |
| `idx_returns_date`, `idx_returns_original` | returns list, “what was already returned on this invoice” |
| `idx_cash_moves_shift (shift_id, moved_at)` | cash closing sums for a shift |
| `idx_*_client_ref` (UNIQUE, partial) | idempotency: a repeated submit cannot create a second document |
| `idx_audit_date`, `idx_adjustments_date` | audit viewer, adjustments list |

Deliberate omissions: no index on `sales.invoice_no` (already `UNIQUE`), no index on
`products.barcode` (a `UNIQUE` constraint exists on the column, and additional barcodes live in
`product_barcodes.barcode` which is `UNIQUE`).

---

## 5. Migrations

- All schema statements live in `MIGRATIONS` in [src/db/schema.ts](src/db/schema.ts); each entry is
  `{ version, name, statements }` and `LATEST_SCHEMA_VERSION` is derived from the list.
- `Database.migrate()` reads `PRAGMA user_version` and applies every migration with a higher
  number **inside its own transaction**, then sets `user_version`. A failed migration rolls back
  completely and leaves the previous version intact.
- Migrations are forward-only and additive. Existing columns are never dropped or retyped in
  place; a rebuild uses a new table plus a copy, so an interrupted upgrade cannot half-migrate a
  shop's data.
- Before a restore the schema version of the backup is compared with the running app's version:
  a backup from a **newer** app is refused instead of being silently misread.
- `npm test` runs the migration twice against a fresh file and asserts the version, the seeded
  rows and `PRAGMA integrity_check`, plus that `PRAGMA foreign_keys` is actually on.

---

## 6. Transaction and consistency rules

1. **One connection, one queue.** `Database` serializes every statement (`src/db/database.ts`), so
   the JS side can never interleave two write transactions on the same connection.
2. **A document is one transaction.** Sales, purchases, returns, adjustments and closings each run
   through `db.tx(...)`: header, lines, stock movements, ledger entries, payments, cash movements
   and audit rows commit together or not at all. The tests inject failures mid-document and assert
   that stock, ledger and cash are untouched.
3. **Caches are derived.** `products.stock_micro` and `parties.balance_paisa` are updated inside the
   same transaction as the movement/ledger row that justifies the change, and tests assert
   `stock_micro == SUM(stock_movements.qty_micro)`.
4. **Nothing finalized is deleted.** Sales, purchases, returns, payments and stock movements get
   reversed (`status = 'reversed'`, `reversal_of`/`is_void`) with a reason and actor; the row stays.
5. **Idempotency.** Every document created from a UI form carries a `client_ref` generated when the
   form opens. The partial unique indexes above make a duplicate tap a database-level no-op
   (the service recognises the existing document and returns it) rather than a second invoice.
6. **Numbering.** `sequences` is incremented inside the document transaction; document numbers are
   formatted from settings (`INV-`, `PUR-`, …) and are unique per prefix. A rolled-back sale does
   not consume a number.
7. **Validation at two boundaries.** Zod schemas validate UI input; services re-validate the same
   invariants (positive quantity, no negative stock unless allowed, discount not exceeding the
   line, return not exceeding sold quantity) and throw typed errors that the screens render.

---

## 7. Query patterns and pagination

- **Keyset (cursor) pagination only.** Product lists page on `(sort_value, id)` and sales history on
  `(sold_at, id)`; the cursor is the last row's value. `OFFSET` is never used, so page 20 costs the
  same as page 1 (measured: 1.7 ms vs 0.9 ms on 2,000 products).
- **List views select only what they show.** Products list selects the columns of `products` needed
  for the row; detail screens load units, movements and history on demand.
- **Search** runs against `search_blob` (lower-cased, Urdu-normalized, digits normalized) with an
  escaped `LIKE` pattern, so `چینی`, `cheeni`-style Latin queries and SKU/barcode both hit one
  index. Input is debounced in the UI; the term is never concatenated into SQL.
- **All SQL is parameterized.** The only strings ever interpolated are fixed fragments chosen by
  code (sort columns, direction) — never user input.
- **No N+1.** Lists fetch rows in one statement (`line_count` for sales comes from a correlated
  scalar subquery over an indexed `sale_id`, executed by SQLite, not by a loop in JS).

---

## 8. Backup, restore and scaling limits

**Backup** — `db.backupTo(path)` issues `VACUUM INTO`, which writes a consistent, defragmented
snapshot even with WAL active. The file is checksummed, its size/version recorded in `backups`, and
when encryption is requested the bytes are sealed with an AES-GCM key from the Android Keystore
before leaving the app.

**Restore** — the candidate file is opened read-only and checked (`PRAGMA integrity_check` plus
`schema_version`); only then is the live file replaced, and the reopened database is integrity
checked again. A failure leaves the previous database in place.

**Scale** — measured on this project's benchmark: 2,000 products, 40,000 sales, 120,000 sale lines
= 25.8 MB, with 1–2 ms pages and 9–14 ms monthly aggregates. Extrapolating linearly, a shop doing
100 sales/day for five years produces ~180,000 sales and well under 500 MB — comfortably within
SQLite's ability on a phone. The honest limits:

- Aggregates over **years** of data (e.g. profit for “all time”) scan more rows; they are date
  bounded in the UI for this reason.
- `search_blob LIKE '%term%'` is an index-assisted scan, not FTS5. It is fast for a shop catalogue
  (thousands of products) but would need FTS5 for a 100k+ SKU catalogue; that is the first
  optimisation to reach for if a store ever outgrows this design.
- Backup size and time grow with the file; a 500 MB database takes seconds, not milliseconds, which
  is why backups run off the UI path with progress.
- Multi-device sync is out of scope: this is a single-device, local-first database.

