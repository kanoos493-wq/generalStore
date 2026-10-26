/**
 * SQLite schema and migrations.
 *
 * Design rules (full documentation in DATABASE_DESIGN.md):
 *  - Money = INTEGER paisa, quantity = INTEGER micro base units.
 *  - All ids are TEXT (time-ordered, stable across backup/restore).
 *  - Timestamps are TEXT ISO-8601 UTC.
 *  - Finalized financial documents are never deleted; they are reversed.
 *  - products.stock_micro / parties.balance_paisa are transactional caches of
 *    the immutable stock_movements / ledger_entries audit trails.
 *  - SQL avoids features missing on older Android SQLite builds
 *    (no RETURNING, no window functions, no UPSERT, no FTS5).
 */

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const V1: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE units (
     code TEXT PRIMARY KEY,
     name_en TEXT NOT NULL,
     name_ur TEXT NOT NULL,
     dimension TEXT NOT NULL,
     canonical_micro INTEGER NOT NULL,
     builtin INTEGER NOT NULL DEFAULT 1
   )`,

  `CREATE TABLE categories (
     id TEXT PRIMARY KEY,
     name_en TEXT NOT NULL,
     name_ur TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE brands (
     id TEXT PRIMARY KEY,
     name_en TEXT NOT NULL,
     name_ur TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE suppliers (
     id TEXT PRIMARY KEY,
     code TEXT UNIQUE,
     name_en TEXT NOT NULL,
     name_ur TEXT,
     phone TEXT,
     whatsapp TEXT,
     address TEXT,
     contact_person TEXT,
     opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
     credit_days INTEGER NOT NULL DEFAULT 0,
     notes TEXT,
     is_active INTEGER NOT NULL DEFAULT 1,
     balance_paisa INTEGER NOT NULL DEFAULT 0,
     search_blob TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  `CREATE TABLE customers (
     id TEXT PRIMARY KEY,
     code TEXT UNIQUE,
     name_en TEXT NOT NULL,
     name_ur TEXT,
     phone TEXT,
     whatsapp TEXT,
     address TEXT,
     opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
     credit_limit_paisa INTEGER NOT NULL DEFAULT 0,
     credit_days INTEGER NOT NULL DEFAULT 0,
     notes TEXT,
     is_active INTEGER NOT NULL DEFAULT 1,
     balance_paisa INTEGER NOT NULL DEFAULT 0,
     search_blob TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  `CREATE TABLE products (
     id TEXT PRIMARY KEY,
     code TEXT NOT NULL UNIQUE,
     name_en TEXT NOT NULL,
     name_ur TEXT,
     barcode TEXT,
     category_id TEXT REFERENCES categories(id),
     brand_id TEXT REFERENCES brands(id),
     supplier_id TEXT REFERENCES suppliers(id),
     base_unit TEXT NOT NULL REFERENCES units(code),
     sale_price_paisa INTEGER NOT NULL DEFAULT 0,
     cost_paisa INTEGER NOT NULL DEFAULT 0,
     stock_micro INTEGER NOT NULL DEFAULT 0,
     min_stock_micro INTEGER NOT NULL DEFAULT 0,
     target_stock_micro INTEGER NOT NULL DEFAULT 0,
     reorder_qty_micro INTEGER NOT NULL DEFAULT 0,
     track_expiry INTEGER NOT NULL DEFAULT 0,
     tax_bp INTEGER NOT NULL DEFAULT 0,
     is_active INTEGER NOT NULL DEFAULT 1,
     notes TEXT,
     search_blob TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     archived_at TEXT
   )`,

  `CREATE TABLE product_barcodes (
     id TEXT PRIMARY KEY,
     product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     barcode TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE product_units (
     id TEXT PRIMARY KEY,
     product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     unit_code TEXT NOT NULL,
     kind TEXT NOT NULL,
     factor_micro INTEGER NOT NULL,
     price_paisa INTEGER,
     is_default INTEGER NOT NULL DEFAULT 0,
     UNIQUE (product_id, unit_code, kind)
   )`,

  `CREATE TABLE payment_methods (
     id TEXT PRIMARY KEY,
     code TEXT NOT NULL UNIQUE,
     name_en TEXT NOT NULL,
     name_ur TEXT NOT NULL,
     is_cash INTEGER NOT NULL DEFAULT 0,
     is_credit INTEGER NOT NULL DEFAULT 0,
     is_active INTEGER NOT NULL DEFAULT 1,
     sort INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE shifts (
     id TEXT PRIMARY KEY,
     opened_at TEXT NOT NULL,
     closed_at TEXT,
     opening_cash_paisa INTEGER NOT NULL DEFAULT 0,
     expected_cash_paisa INTEGER NOT NULL DEFAULT 0,
     counted_cash_paisa INTEGER,
     difference_paisa INTEGER,
     status TEXT NOT NULL DEFAULT 'open',
     notes TEXT,
     opened_by TEXT,
     closed_by TEXT
   )`,

  `CREATE TABLE purchases (
     id TEXT PRIMARY KEY,
     doc_no TEXT NOT NULL UNIQUE,
     supplier_id TEXT REFERENCES suppliers(id),
     supplier_name TEXT,
     ref_no TEXT,
     purchased_at TEXT NOT NULL,
     due_date TEXT,
     subtotal_paisa INTEGER NOT NULL DEFAULT 0,
     discount_paisa INTEGER NOT NULL DEFAULT 0,
     freight_paisa INTEGER NOT NULL DEFAULT 0,
     tax_paisa INTEGER NOT NULL DEFAULT 0,
     total_paisa INTEGER NOT NULL DEFAULT 0,
     paid_paisa INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'posted',
     notes TEXT,
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT,
     reversed_at TEXT,
     reversed_by TEXT,
     reversal_reason TEXT
   )`,

  `CREATE TABLE purchase_lines (
     id TEXT PRIMARY KEY,
     purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
     product_id TEXT NOT NULL REFERENCES products(id),
     product_name TEXT NOT NULL,
     unit_code TEXT NOT NULL,
     qty_micro INTEGER NOT NULL,
     factor_micro INTEGER NOT NULL,
     base_qty_micro INTEGER NOT NULL,
     unit_cost_paisa INTEGER NOT NULL,
     line_discount_paisa INTEGER NOT NULL DEFAULT 0,
     line_total_paisa INTEGER NOT NULL,
     cost_per_base_paisa INTEGER NOT NULL
   )`,

  `CREATE TABLE sales (
     id TEXT PRIMARY KEY,
     invoice_no TEXT NOT NULL UNIQUE,
     customer_id TEXT REFERENCES customers(id),
     customer_name TEXT,
     sold_at TEXT NOT NULL,
     subtotal_paisa INTEGER NOT NULL DEFAULT 0,
     discount_paisa INTEGER NOT NULL DEFAULT 0,
     tax_paisa INTEGER NOT NULL DEFAULT 0,
     total_paisa INTEGER NOT NULL DEFAULT 0,
     paid_paisa INTEGER NOT NULL DEFAULT 0,
     credit_paisa INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'posted',
     shift_id TEXT REFERENCES shifts(id),
     notes TEXT,
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT,
     reversed_at TEXT,
     reversal_reason TEXT
   )`,

  `CREATE TABLE sale_lines (
     id TEXT PRIMARY KEY,
     sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
     product_id TEXT NOT NULL REFERENCES products(id),
     product_name TEXT NOT NULL,
     unit_code TEXT NOT NULL,
     qty_micro INTEGER NOT NULL,
     factor_micro INTEGER NOT NULL,
     base_qty_micro INTEGER NOT NULL,
     unit_price_paisa INTEGER NOT NULL,
     line_discount_paisa INTEGER NOT NULL DEFAULT 0,
     line_total_paisa INTEGER NOT NULL,
     unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
     cogs_paisa INTEGER NOT NULL DEFAULT 0,
     returned_qty_micro INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE payments (
     id TEXT PRIMARY KEY,
     party_type TEXT NOT NULL,
     party_id TEXT,
     party_name TEXT,
     direction TEXT NOT NULL,
     method_id TEXT NOT NULL REFERENCES payment_methods(id),
     amount_paisa INTEGER NOT NULL,
     paid_at TEXT NOT NULL,
     doc_type TEXT NOT NULL,
     doc_id TEXT,
     reference TEXT,
     notes TEXT,
     is_void INTEGER NOT NULL DEFAULT 0,
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE ledger_entries (
     id TEXT PRIMARY KEY,
     party_type TEXT NOT NULL,
     party_id TEXT NOT NULL,
     entry_at TEXT NOT NULL,
     doc_type TEXT NOT NULL,
     doc_id TEXT,
     description TEXT NOT NULL,
     debit_paisa INTEGER NOT NULL DEFAULT 0,
     credit_paisa INTEGER NOT NULL DEFAULT 0,
     balance_paisa INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE stock_movements (
     id TEXT PRIMARY KEY,
     product_id TEXT NOT NULL REFERENCES products(id),
     moved_at TEXT NOT NULL,
     type TEXT NOT NULL,
     qty_micro INTEGER NOT NULL,
     unit_code TEXT NOT NULL,
     entered_qty_micro INTEGER NOT NULL,
     factor_micro INTEGER NOT NULL,
     unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
     balance_after_micro INTEGER NOT NULL,
     doc_type TEXT NOT NULL,
     doc_id TEXT,
     doc_no TEXT,
     reason TEXT,
     notes TEXT,
     created_by TEXT,
     reversal_of TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE adjustments (
     id TEXT PRIMARY KEY,
     doc_no TEXT NOT NULL UNIQUE,
     adjusted_at TEXT NOT NULL,
     type TEXT NOT NULL,
     reason TEXT NOT NULL,
     notes TEXT,
     supplier_id TEXT REFERENCES suppliers(id),
     total_cost_paisa INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'posted',
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE adjustment_lines (
     id TEXT PRIMARY KEY,
     adjustment_id TEXT NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
     product_id TEXT NOT NULL REFERENCES products(id),
     product_name TEXT NOT NULL,
     unit_code TEXT NOT NULL,
     qty_micro INTEGER NOT NULL,
     factor_micro INTEGER NOT NULL,
     base_qty_micro INTEGER NOT NULL,
     unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
     system_qty_micro INTEGER,
     counted_qty_micro INTEGER
   )`,

  `CREATE TABLE returns (
     id TEXT PRIMARY KEY,
     doc_no TEXT NOT NULL UNIQUE,
     type TEXT NOT NULL,
     original_id TEXT,
     original_no TEXT,
     party_type TEXT NOT NULL,
     party_id TEXT,
     party_name TEXT,
     returned_at TEXT NOT NULL,
     subtotal_paisa INTEGER NOT NULL DEFAULT 0,
     total_paisa INTEGER NOT NULL DEFAULT 0,
     refund_method_id TEXT REFERENCES payment_methods(id),
     refunded_paisa INTEGER NOT NULL DEFAULT 0,
     restock INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'posted',
     reason TEXT,
     notes TEXT,
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE return_lines (
     id TEXT PRIMARY KEY,
     return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
     product_id TEXT NOT NULL REFERENCES products(id),
     product_name TEXT NOT NULL,
     sale_line_id TEXT,
     purchase_line_id TEXT,
     unit_code TEXT NOT NULL,
     qty_micro INTEGER NOT NULL,
     factor_micro INTEGER NOT NULL,
     base_qty_micro INTEGER NOT NULL,
     unit_price_paisa INTEGER NOT NULL,
     unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
     line_total_paisa INTEGER NOT NULL,
     damage_qty_micro INTEGER NOT NULL DEFAULT 0
   )`,

  `CREATE TABLE expense_categories (
     id TEXT PRIMARY KEY,
     name_en TEXT NOT NULL,
     name_ur TEXT NOT NULL,
     is_active INTEGER NOT NULL DEFAULT 1
   )`,

  `CREATE TABLE expenses (
     id TEXT PRIMARY KEY,
     doc_no TEXT NOT NULL UNIQUE,
     category_id TEXT NOT NULL REFERENCES expense_categories(id),
     description TEXT NOT NULL,
     amount_paisa INTEGER NOT NULL,
     spent_at TEXT NOT NULL,
     method_id TEXT NOT NULL REFERENCES payment_methods(id),
     payee TEXT,
     reference TEXT,
     notes TEXT,
     is_cash INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'posted',
     voided_at TEXT,
     void_reason TEXT,
     client_ref TEXT,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE cash_movements (
     id TEXT PRIMARY KEY,
     shift_id TEXT NOT NULL REFERENCES shifts(id),
     moved_at TEXT NOT NULL,
     direction TEXT NOT NULL,
     amount_paisa INTEGER NOT NULL,
     source_type TEXT NOT NULL,
     source_id TEXT,
     description TEXT NOT NULL,
     created_at TEXT NOT NULL,
     created_by TEXT
   )`,

  `CREATE TABLE sequences (
     key TEXT PRIMARY KEY,
     next_value INTEGER NOT NULL
   )`,

  `CREATE TABLE audit_events (
     id TEXT PRIMARY KEY,
     at TEXT NOT NULL,
     actor TEXT,
     action TEXT NOT NULL,
     entity TEXT,
     entity_id TEXT,
     details TEXT
   )`,

  `CREATE TABLE backups (
     id TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     path TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     encrypted INTEGER NOT NULL DEFAULT 0,
     schema_version INTEGER NOT NULL,
     checksum TEXT,
     status TEXT NOT NULL,
     notes TEXT
   )`,

  // ---- indexes tuned to the real query patterns ----
  `CREATE INDEX idx_products_active_name ON products(is_active, name_en)`,
  `CREATE INDEX idx_products_archived ON products(archived_at)`,
  `CREATE INDEX idx_products_search ON products(search_blob)`,
  `CREATE INDEX idx_products_category ON products(category_id)`,
  `CREATE INDEX idx_products_stock ON products(stock_micro)`,
  `CREATE INDEX idx_product_units_product ON product_units(product_id, kind)`,
  `CREATE INDEX idx_customers_search ON customers(search_blob)`,
  `CREATE INDEX idx_customers_active ON customers(is_active, name_en)`,
  `CREATE INDEX idx_suppliers_search ON suppliers(search_blob)`,
  `CREATE INDEX idx_suppliers_active ON suppliers(is_active, name_en)`,
  `CREATE INDEX idx_sales_date ON sales(sold_at)`,
  `CREATE INDEX idx_sales_customer ON sales(customer_id, sold_at)`,
  `CREATE INDEX idx_sales_status ON sales(status, sold_at)`,
  `CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id)`,
  `CREATE INDEX idx_sale_lines_product ON sale_lines(product_id)`,
  `CREATE INDEX idx_purchases_date ON purchases(purchased_at)`,
  `CREATE INDEX idx_purchases_supplier ON purchases(supplier_id, purchased_at)`,
  `CREATE INDEX idx_purchase_lines_purchase ON purchase_lines(purchase_id)`,
  `CREATE INDEX idx_purchase_lines_product ON purchase_lines(product_id)`,
  `CREATE INDEX idx_stock_moves_product_date ON stock_movements(product_id, moved_at)`,
  `CREATE INDEX idx_stock_moves_date ON stock_movements(moved_at)`,
  `CREATE INDEX idx_stock_moves_doc ON stock_movements(doc_type, doc_id)`,
  `CREATE INDEX idx_ledger_party_date ON ledger_entries(party_type, party_id, entry_at)`,
  `CREATE INDEX idx_ledger_doc ON ledger_entries(doc_type, doc_id)`,
  `CREATE INDEX idx_payments_party ON payments(party_type, party_id, paid_at)`,
  `CREATE INDEX idx_payments_doc ON payments(doc_type, doc_id)`,
  `CREATE INDEX idx_payments_date ON payments(paid_at)`,
  `CREATE INDEX idx_expenses_date ON expenses(spent_at)`,
  `CREATE INDEX idx_expenses_category ON expenses(category_id, spent_at)`,
  `CREATE INDEX idx_returns_date ON returns(returned_at)`,
  `CREATE INDEX idx_returns_original ON returns(original_id)`,
  `CREATE INDEX idx_cash_moves_shift ON cash_movements(shift_id, moved_at)`,
  `CREATE UNIQUE INDEX idx_sales_client_ref ON sales(client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX idx_purchases_client_ref ON purchases(client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX idx_returns_client_ref ON returns(client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX idx_expenses_client_ref ON expenses(client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX idx_payments_client_ref ON payments(client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE INDEX idx_audit_date ON audit_events(at)`,
  `CREATE INDEX idx_adjustments_date ON adjustments(adjusted_at)`,
];

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', statements: V1 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Splits a script into statements (used only by tooling/tests). */
export function splitStatements(script: string): string[] {
  return script
    .split(';\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.endsWith(';') ? s : `${s};`));
}
