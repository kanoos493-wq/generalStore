/** Dashboard aggregates. Every number comes from posted documents. */
import type { Database } from '../db/database';
import type { DateRange } from '../core/dates';
import { mulDivRound, QTY_SCALE } from '../core/money';
import { currentShiftSummary, type CashSummary } from './cashService';
import { expensesTotal, profitReport, salesSummary, type SalesSummaryTotals } from './reportService';

type SalesSummary = SalesSummaryTotals;

export interface DashboardData {
  range: DateRange;
  sales: SalesSummary;
  profit: { grossProfitPaisa: number; operatingProfitPaisa: number; expensesPaisa: number; cogsPaisa: number };
  cashPaymentsPaisa: number;
  digitalPaymentsPaisa: number;
  customerReceiptsPaisa: number;
  supplierPaymentsPaisa: number;
  purchasesPaisa: number;
  stockItemCount: number;
  stockQtyMicro: number;
  stockValuePaisa: number;
  lowStockCount: number;
  outOfStockCount: number;
  receivablesPaisa: number;
  payablesPaisa: number;
  cash: CashSummary & { shiftId: string | null };
  lastClosing: { closedAt: string; differencePaisa: number } | null;
  topProducts: { productName: string; qtyMicro: number; unit: string; salesPaisa: number }[];
  trend: { day: string; salesPaisa: number }[];
  recentSales: Record<string, string | number | null>[];
  recentPurchases: Record<string, string | number | null>[];
  recentExpenses: Record<string, string | number | null>[];
  lowStock: Record<string, string | number | null>[];
}

export async function loadDashboard(db: Database, range: DateRange): Promise<DashboardData> {
  const sales = await salesSummary(db, range);
  const profit = await profitReport(db, range);
  const expenses = await expensesTotal(db, range);

  const payments = await db.one<{ cash: number; digital: number; receipts: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN m.is_cash = 1 AND p.direction = 'in' THEN p.amount_paisa ELSE 0 END),0) AS cash,
       COALESCE(SUM(CASE WHEN m.is_cash = 0 AND p.direction = 'in' THEN p.amount_paisa ELSE 0 END),0) AS digital,
       COALESCE(SUM(CASE WHEN p.doc_type = 'receipt' AND p.direction = 'in' THEN p.amount_paisa ELSE 0 END),0) AS receipts
     FROM payments p JOIN payment_methods m ON m.id = p.method_id
     WHERE p.is_void = 0 AND p.paid_at >= ? AND p.paid_at <= ?`,
    [range.from, range.to],
  );
  const supplierPayments = await db.one<{ total: number }>(
    `SELECT COALESCE(SUM(amount_paisa),0) AS total FROM payments
     WHERE is_void = 0 AND direction = 'out' AND paid_at >= ? AND paid_at <= ?`,
    [range.from, range.to],
  );
  const purchases = await db.one<{ total: number }>(
    `SELECT COALESCE(SUM(total_paisa),0) AS total FROM purchases
     WHERE status = 'posted' AND purchased_at >= ? AND purchased_at <= ?`,
    [range.from, range.to],
  );

  const stock = await db.one<{ count: number; qty: number; value_micro: number; low: number; out: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(stock_micro),0) AS qty,
            COALESCE(SUM(stock_micro * cost_paisa),0) AS value_micro,
            COALESCE(SUM(CASE WHEN stock_micro > 0 AND stock_micro <= min_stock_micro THEN 1 ELSE 0 END),0) AS low,
            COALESCE(SUM(CASE WHEN stock_micro <= 0 THEN 1 ELSE 0 END),0) AS out
     FROM products WHERE archived_at IS NULL AND is_active = 1`,
  );

  const receivables = await db.one<{ total: number }>(
    'SELECT COALESCE(SUM(balance_paisa),0) AS total FROM customers WHERE balance_paisa > 0',
  );
  const payables = await db.one<{ total: number }>(
    'SELECT COALESCE(SUM(balance_paisa),0) AS total FROM suppliers WHERE balance_paisa > 0',
  );

  const lastClosing = await db.one<{ closed_at: string; difference_paisa: number }>(
    `SELECT closed_at, COALESCE(difference_paisa,0) AS difference_paisa FROM shifts
     WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
  );

  const top = await db.query(
    `SELECT l.product_name, SUM(l.base_qty_micro) AS qty, p.base_unit AS unit,
            SUM(l.line_total_paisa - l.line_discount_paisa) AS sales
     FROM sale_lines l JOIN sales s ON s.id = l.sale_id
     LEFT JOIN products p ON p.id = l.product_id
     WHERE s.status = 'posted' AND s.sold_at >= ? AND s.sold_at <= ?
     GROUP BY l.product_name, p.base_unit ORDER BY sales DESC LIMIT 5`,
    [range.from, range.to],
  );

  const trend = await db.query(
    `SELECT date(sold_at, 'localtime') AS day, COALESCE(SUM(total_paisa),0) AS sales
     FROM sales WHERE status = 'posted' AND sold_at >= ? AND sold_at <= ?
     GROUP BY day ORDER BY day ASC`,
    [range.from, range.to],
  );

  const recentSales = await db.query(
    `SELECT id, invoice_no, customer_name, sold_at, total_paisa, paid_paisa, credit_paisa, status
     FROM sales ORDER BY sold_at DESC, id DESC LIMIT 5`,
  );
  const recentPurchases = await db.query(
    `SELECT id, doc_no, supplier_name, purchased_at, total_paisa, paid_paisa, status
     FROM purchases ORDER BY purchased_at DESC, id DESC LIMIT 5`,
  );
  const recentExpenses = await db.query(
    `SELECT e.id, e.doc_no, e.description, e.spent_at, e.amount_paisa, c.name_en AS category
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.status = 'posted' ORDER BY e.spent_at DESC LIMIT 5`,
  );
  const lowStock = await db.query(
    `SELECT id, name_en, stock_micro, min_stock_micro, base_unit FROM products
     WHERE archived_at IS NULL AND is_active = 1 AND stock_micro <= min_stock_micro
     ORDER BY stock_micro ASC LIMIT 5`,
  );

  const cash = await currentShiftSummary(db);

  return {
    range,
    sales,
    profit: {
      grossProfitPaisa: profit.grossProfitPaisa,
      operatingProfitPaisa: profit.operatingProfitPaisa,
      expensesPaisa: expenses,
      cogsPaisa: profit.cogsPaisa,
    },
    cashPaymentsPaisa: Number(payments?.cash ?? 0),
    digitalPaymentsPaisa: Number(payments?.digital ?? 0),
    customerReceiptsPaisa: Number(payments?.receipts ?? 0),
    supplierPaymentsPaisa: Number(supplierPayments?.total ?? 0),
    purchasesPaisa: Number(purchases?.total ?? 0),
    stockItemCount: Number(stock?.count ?? 0),
    stockQtyMicro: Number(stock?.qty ?? 0),
    stockValuePaisa: mulDivRound(Number(stock?.value_micro ?? 0), 1, QTY_SCALE),
    lowStockCount: Number(stock?.low ?? 0),
    outOfStockCount: Number(stock?.out ?? 0),
    receivablesPaisa: Number(receivables?.total ?? 0),
    payablesPaisa: Number(payables?.total ?? 0),
    cash,
    lastClosing: lastClosing
      ? { closedAt: lastClosing.closed_at, differencePaisa: Number(lastClosing.difference_paisa) }
      : null,
    topProducts: top.map(r => ({
      productName: String(r.product_name ?? ''),
      qtyMicro: Number(r.qty ?? 0),
      unit: String(r.unit ?? ''),
      salesPaisa: Number(r.sales ?? 0),
    })),
    trend: trend.map(r => ({ day: String(r.day ?? ''), salesPaisa: Number(r.sales ?? 0) })),
    recentSales: recentSales as Record<string, string | number | null>[],
    recentPurchases: recentPurchases as Record<string, string | number | null>[],
    recentExpenses: recentExpenses as Record<string, string | number | null>[],
    lowStock: lowStock as Record<string, string | number | null>[],
  };
}
