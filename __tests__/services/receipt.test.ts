import { buildReceipt, checkReceipt, columnsFor, type ReceiptData } from '../../src/services/receiptService';
import type { SaleLineRow, SaleRow } from '../../src/db/types';

const sale: SaleRow = {
  id: 'sale_1',
  invoice_no: 'INV-20261026-0001',
  customer_id: null,
  customer_name: null,
  sold_at: '2026-10-26T10:30:00.000Z',
  subtotal_paisa: 22500,
  discount_paisa: 0,
  tax_paisa: 0,
  total_paisa: 22500,
  paid_paisa: 22500,
  credit_paisa: 0,
  status: 'posted',
  shift_id: null,
  notes: null,
  client_ref: null,
  created_at: '2026-10-26T10:30:00.000Z',
  created_by: 'Owner',
  reversed_at: null,
  reversal_reason: null,
};

const line = (over: Partial<SaleLineRow>): SaleLineRow => ({
  id: 'l1',
  sale_id: 'sale_1',
  product_id: 'p1',
  product_name: 'Sugar',
  unit_code: 'g',
  qty_micro: 500000,
  factor_micro: 1000,
  base_qty_micro: 500000,
  unit_price_paisa: 15,
  line_discount_paisa: 0,
  line_total_paisa: 7500,
  unit_cost_paisa: 12000,
  cogs_paisa: 6000,
  returned_qty_micro: 0,
  ...over,
});

const data: ReceiptData = {
  sale,
  lines: [
    line({}),
    line({ id: 'l2', product_name: 'Basmati Rice (Super Kernel) 5kg Bag', unit_code: 'kg', qty_micro: 1000000, factor_micro: 1000000, base_qty_micro: 1000000, unit_price_paisa: 15000, line_total_paisa: 15000 }),
  ],
  payments: [{ methodName: 'Cash', amountPaisa: 25000 }],
  store: {
    nameEn: 'Al-Madina General Store',
    nameUr: 'المدینہ جنرل اسٹور',
    address: 'Shop 12, Main Bazaar, Lahore',
    phone: '0300-1234567',
    footer: 'Thank you for shopping with us!',
    terms: 'Exchange within 7 days with receipt.',
    returnPolicy: 'No return on perishable items.',
  },
  cashier: 'Owner',
  language: 'both',
};

describe('receipt builder', () => {
  it('uses the right column count per paper width', () => {
    expect(columnsFor(58)).toBe(32);
    expect(columnsFor(80)).toBe(42);
  });

  it('renders header, items and totals within the paper width', () => {
    const text = buildReceipt(data, 58);
    const lines = text.split('\n');
    expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(32);
    expect(text).toContain('INV-20261026-0001');
    expect(text).toContain('Sugar');
    expect(text).toContain('225.00');
    expect(text).toContain('Thank you for shopping');
  });

  it('prints both store names and wraps long product names', () => {
    const text = buildReceipt(data, 58);
    expect(text).toContain('AL-MADINA GENERAL STORE');
    expect(text).toContain('المدینہ جنرل اسٹور');
    expect(text).toContain('Basmati Rice');
    expect(text).toContain('Super Kernel');
  });

  it('marks reprints clearly', () => {
    expect(buildReceipt({ ...data, duplicate: true }, 80)).toContain('DUPLICATE');
  });

  it('shows the remaining khata balance when paying on credit', () => {
    const creditSale = { ...sale, credit_paisa: 10000, paid_paisa: 12500, total_paisa: 22500 };
    const text = buildReceipt(
      { ...data, sale: creditSale, previousBalancePaisa: 50000, customerBalancePaisa: 60000 },
      80,
    );
    expect(text).toContain('On credit');
    expect(text).toContain('Previous balance');
    expect(text).toContain('600.00');
  });

  it('reconciles printed totals with the stored invoice', () => {
    expect(checkReceipt(data.lines, sale).ok).toBe(true);
    const broken = { ...sale, total_paisa: 99999 };
    const result = checkReceipt(data.lines, broken);
    expect(result.ok).toBe(false);
    expect(result.expectedTotalPaisa).toBe(22500);
  });
});
