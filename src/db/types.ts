/**
 * Row types mirroring the SQLite schema (snake_case on purpose: the app reads
 * rows directly, avoiding a mapping layer that would only add bugs).
 */
export interface ProductRow {
  id: string;
  code: string;
  name_en: string;
  name_ur: string | null;
  barcode: string | null;
  category_id: string | null;
  brand_id: string | null;
  supplier_id: string | null;
  base_unit: string;
  sale_price_paisa: number;
  cost_paisa: number;
  stock_micro: number;
  min_stock_micro: number;
  target_stock_micro: number;
  reorder_qty_micro: number;
  track_expiry: number;
  tax_bp: number;
  is_active: number;
  notes: string | null;
  search_blob: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ProductUnitRow {
  id: string;
  product_id: string;
  unit_code: string;
  kind: 'purchase' | 'sale';
  factor_micro: number;
  price_paisa: number | null;
  is_default: number;
}

export interface PartyRow {
  id: string;
  code: string | null;
  name_en: string;
  name_ur: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  contact_person?: string | null;
  opening_balance_paisa: number;
  credit_limit_paisa?: number;
  credit_days: number;
  notes: string | null;
  is_active: number;
  balance_paisa: number;
  search_blob: string;
  created_at: string;
  updated_at: string;
}

export interface SaleRow {
  id: string;
  invoice_no: string;
  customer_id: string | null;
  customer_name: string | null;
  sold_at: string;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  credit_paisa: number;
  status: string;
  shift_id: string | null;
  notes: string | null;
  client_ref: string | null;
  created_at: string;
  created_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface SaleLineRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  unit_code: string;
  qty_micro: number;
  factor_micro: number;
  base_qty_micro: number;
  unit_price_paisa: number;
  line_discount_paisa: number;
  line_total_paisa: number;
  unit_cost_paisa: number;
  cogs_paisa: number;
  returned_qty_micro: number;
}

export interface PurchaseRow {
  id: string;
  doc_no: string;
  supplier_id: string | null;
  supplier_name: string | null;
  ref_no: string | null;
  purchased_at: string;
  due_date: string | null;
  subtotal_paisa: number;
  discount_paisa: number;
  freight_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  status: string;
  notes: string | null;
  client_ref: string | null;
  created_at: string;
  created_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
}

export interface PurchaseLineRow {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name: string;
  unit_code: string;
  qty_micro: number;
  factor_micro: number;
  base_qty_micro: number;
  unit_cost_paisa: number;
  line_discount_paisa: number;
  line_total_paisa: number;
  cost_per_base_paisa: number;
}

export interface StockMovementRow {
  id: string;
  product_id: string;
  moved_at: string;
  type: string;
  qty_micro: number;
  unit_code: string;
  entered_qty_micro: number;
  factor_micro: number;
  unit_cost_paisa: number;
  balance_after_micro: number;
  doc_type: string;
  doc_id: string | null;
  doc_no: string | null;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  reversal_of: string | null;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  party_type: 'customer' | 'supplier';
  party_id: string;
  entry_at: string;
  doc_type: string;
  doc_id: string | null;
  description: string;
  debit_paisa: number;
  credit_paisa: number;
  balance_paisa: number;
  created_at: string;
  created_by: string | null;
}

export interface PaymentRow {
  id: string;
  party_type: 'customer' | 'supplier';
  party_id: string | null;
  party_name: string | null;
  direction: 'in' | 'out';
  method_id: string;
  amount_paisa: number;
  paid_at: string;
  doc_type: string;
  doc_id: string | null;
  reference: string | null;
  notes: string | null;
  is_void: number;
  client_ref: string | null;
  created_at: string;
  created_by: string | null;
}

export interface PaymentMethodRow {
  id: string;
  code: string;
  name_en: string;
  name_ur: string;
  is_cash: number;
  is_credit: number;
  is_active: number;
  sort: number;
}

export interface ShiftRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash_paisa: number;
  expected_cash_paisa: number;
  counted_cash_paisa: number | null;
  difference_paisa: number | null;
  status: 'open' | 'closed';
  notes: string | null;
  opened_by: string | null;
  closed_by: string | null;
}

export interface ExpenseRow {
  id: string;
  doc_no: string;
  category_id: string;
  category_name?: string;
  description: string;
  amount_paisa: number;
  spent_at: string;
  method_id: string;
  method_name?: string;
  payee: string | null;
  reference: string | null;
  notes: string | null;
  is_cash: number;
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  created_by: string | null;
}

export interface ReturnRow {
  id: string;
  doc_no: string;
  type: 'sale' | 'purchase';
  original_id: string | null;
  original_no: string | null;
  party_type: 'customer' | 'supplier';
  party_id: string | null;
  party_name: string | null;
  returned_at: string;
  subtotal_paisa: number;
  total_paisa: number;
  refund_method_id: string | null;
  refunded_paisa: number;
  restock: number;
  status: string;
  reason: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export interface AdjustmentRow {
  id: string;
  doc_no: string;
  adjusted_at: string;
  type: string;
  reason: string;
  notes: string | null;
  supplier_id: string | null;
  total_cost_paisa: number;
  status: string;
  created_at: string;
  created_by: string | null;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
}
