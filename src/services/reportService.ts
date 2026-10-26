/**
 * Reporting engine. Reports read real posted documents only (never cached or
 * fake numbers) and are defined declaratively so the UI, CSV and PDF exports
 * share one implementation.
 */
import type { Database } from '../db/database';
import type { DateRange } from '../core/dates';
import { mulDivRound, QTY_SCALE } from '../core/money';
import { profitBreakdown } from '../core/costing';

export type ReportValueKind = 'text' | 'money' | 'qty' | 'number' | 'date' | 'percent' | 'unit';

export interface ReportColumn {
  key: string;
  labelEn: string;
  labelUr: string;
  kind: ReportValueKind;
}

export type ReportRow = Record<string, string | number | null>;

export type ReportGroup = 'sales' | 'purchases' | 'inventory' | 'financial';

export interface ReportDefinition {
  id: string;
  titleEn: string;
  titleUr: string;
  group: ReportGroup;
  needsRange: boolean;
  columns: ReportColumn[];
  run: (db: Database, range: DateRange) => Promise<ReportRow[]>;
}

const col = (key: string, labelEn: string, labelUr: string, kind: ReportValueKind): ReportColumn => ({
  key,
  labelEn,
  labelUr,
  kind,
});

const SALES_POSTED = `s.status = 'posted'`;

async function salesSummaryQuery(db: Database, range: DateRange) {
  const row = await db.one<{
    gross: number; discount: number; tax: number; total: number; paid: number; credit: number; bills: number;
  }>(
    `SELECT COALESCE(SUM(subtotal_paisa),0) AS gross,
            COALESCE(SUM(discount_paisa),0) AS discount,
            COALESCE(SUM(tax_paisa),0) AS tax,
            COALESCE(SUM(total_paisa),0) AS total,
            COALESCE(SUM(paid_paisa),0) AS paid,
            COALESCE(SUM(credit_paisa),0) AS credit,
            COUNT(*) AS bills
     FROM sales s WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?`,
    [range.from, range.to],
  );
  const ret = await db.one<{ total: number; cost_micro: number }>(
    `SELECT COALESCE(SUM(r.total_paisa),0) AS total,
            COALESCE(SUM(l.unit_cost_paisa * l.base_qty_micro),0) AS cost_micro
     FROM returns r LEFT JOIN return_lines l ON l.return_id = r.id
     WHERE r.type = 'sale' AND r.status = 'posted' AND r.returned_at >= ? AND r.returned_at <= ?`,
    [range.from, range.to],
  );
  const cogs = await db.one<{ cogs: number }>(
    `SELECT COALESCE(SUM(l.cogs_paisa),0) AS cogs
     FROM sale_lines l JOIN sales s ON s.id = l.sale_id
     WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?`,
    [range.from, range.to],
  );
  const returnsTotal = Number(ret?.total ?? 0);
  const cogsReturned = mulDivRound(Number(ret?.cost_micro ?? 0), 1, QTY_SCALE);
  return {
    grossSalesPaisa: Number(row?.gross ?? 0),
    discountsPaisa: Number(row?.discount ?? 0),
    taxPaisa: Number(row?.tax ?? 0),
    invoiceTotalPaisa: Number(row?.total ?? 0),
    paidPaisa: Number(row?.paid ?? 0),
    creditPaisa: Number(row?.credit ?? 0),
    billCount: Number(row?.bills ?? 0),
    returnsPaisa: returnsTotal,
    cogsPaisa: Math.max(0, Number(cogs?.cogs ?? 0) - cogsReturned),
    netSalesPaisa: Number(row?.gross ?? 0) - Number(row?.discount ?? 0) - returnsTotal,
  };
}

export interface SalesSummaryTotals {
  grossSalesPaisa: number;
  discountsPaisa: number;
  taxPaisa: number;
  invoiceTotalPaisa: number;
  paidPaisa: number;
  creditPaisa: number;
  billCount: number;
  returnsPaisa: number;
  cogsPaisa: number;
  netSalesPaisa: number;
}

/** Posted-document sales totals for a period (shared by dashboard and reports). */
export async function salesSummary(db: Database, range: DateRange): Promise<SalesSummaryTotals> {
  return salesSummaryQuery(db, range);
}

export async function expensesTotal(db: Database, range: DateRange): Promise<number> {
  const row = await db.one<{ total: number }>(
    `SELECT COALESCE(SUM(amount_paisa),0) AS total FROM expenses
     WHERE status = 'posted' AND spent_at >= ? AND spent_at <= ?`,
    [range.from, range.to],
  );
  return Number(row?.total ?? 0);
}

export async function profitReport(db: Database, range: DateRange) {
  const sales = await salesSummaryQuery(db, range);
  const expenses = await expensesTotal(db, range);
  const breakdown = profitBreakdown({
    grossSalesPaisa: sales.grossSalesPaisa,
    discountsPaisa: sales.discountsPaisa,
    returnsPaisa: sales.returnsPaisa,
    cogsPaisa: sales.cogsPaisa,
    expensesPaisa: expenses,
  });
  return { ...breakdown, billCount: sales.billCount };
}

const REPORTS: ReportDefinition[] = [
  {
    id: 'sales_daily',
    titleEn: 'Sales by day',
    titleUr: 'روزانہ فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('day', 'Date', 'تاریخ', 'date'),
      col('bills', 'Bills', 'بل', 'number'),
      col('gross', 'Gross sales', 'کل فروخت', 'money'),
      col('discount', 'Discounts', 'رعایت', 'money'),
      col('net', 'Net sales', 'خالص فروخت', 'money'),
      col('avg_bill', 'Average bill', 'اوسط بل', 'money'),
    ],
    run: async (db, range) => {
      const rows = await db.query(
        `SELECT s.day, s.bills, s.gross, s.discount,
                s.invoice_net - COALESCE(r.returns, 0) AS net
         FROM (
           SELECT date(sold_at, 'localtime') AS day, COUNT(*) AS bills,
                  COALESCE(SUM(subtotal_paisa),0) AS gross,
                  COALESCE(SUM(discount_paisa),0) AS discount,
                  COALESCE(SUM(subtotal_paisa - discount_paisa),0) AS invoice_net
           FROM sales WHERE status = 'posted' AND sold_at >= ? AND sold_at <= ?
           GROUP BY day
         ) s
         LEFT JOIN (
           SELECT date(returned_at, 'localtime') AS day, COALESCE(SUM(total_paisa),0) AS returns
           FROM returns WHERE type = 'sale' AND status = 'posted'
           GROUP BY day
         ) r ON r.day = s.day
         ORDER BY s.day DESC`,
        [range.from, range.to],
      );
      return rows.map(r => ({
        day: String(r.day ?? ''),
        bills: Number(r.bills ?? 0),
        gross: Number(r.gross ?? 0),
        discount: Number(r.discount ?? 0),
        net: Number(r.net ?? 0),
        avg_bill: Number(r.bills ?? 0) ? Math.round(Number(r.net ?? 0) / Number(r.bills)) : 0,
      }));
    },
  },
  {
    id: 'sales_by_product',
    titleEn: 'Sales by product',
    titleUr: 'مصنوعات کے مطابق فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('product', 'Product', 'مصنوعات', 'text'),
      col('qty', 'Quantity', 'مقدار', 'qty'),
      col('unit', 'Unit', 'یونٹ', 'unit'),
      col('sales', 'Sales', 'فروخت', 'money'),
      col('cost', 'Cost', 'لاگت', 'money'),
      col('profit', 'Gross profit', 'مجموعی منافع', 'money'),
    ],
    run: async (db, range) => {
      const rows = await db.query(
        `SELECT l.product_id, l.product_name,
                SUM(l.base_qty_micro) AS qty_micro,
                SUM(l.line_total_paisa - l.line_discount_paisa) AS sales,
                SUM(l.cogs_paisa) AS cost,
                p.base_unit AS unit
         FROM sale_lines l
         JOIN sales s ON s.id = l.sale_id
         LEFT JOIN products p ON p.id = l.product_id
         WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?
         GROUP BY l.product_id, l.product_name, p.base_unit
         ORDER BY sales DESC LIMIT 300`,
        [range.from, range.to],
      );
      return rows.map(r => ({
        product: String(r.product_name ?? ''),
        qty: Number(r.qty_micro ?? 0),
        unit: String(r.unit ?? ''),
        sales: Number(r.sales ?? 0),
        cost: Number(r.cost ?? 0),
        profit: Number(r.sales ?? 0) - Number(r.cost ?? 0),
      }));
    },
  },
  {
    id: 'sales_by_category',
    titleEn: 'Sales by category',
    titleUr: 'زمرے کے مطابق فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('category', 'Category', 'زمرہ', 'text'),
      col('sales', 'Sales', 'فروخت', 'money'),
      col('qty', 'Quantity', 'مقدار', 'qty'),
    ],
    run: async (db, range) => {
      const rows = await db.query(
        `SELECT COALESCE(c.name_en, 'Uncategorised') AS category,
                SUM(l.line_total_paisa - l.line_discount_paisa) AS sales,
                SUM(l.base_qty_micro) AS qty
         FROM sale_lines l
         JOIN sales s ON s.id = l.sale_id
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?
         GROUP BY category ORDER BY sales DESC`,
        [range.from, range.to],
      );
      return rows.map(r => ({ category: String(r.category ?? ''), sales: Number(r.sales ?? 0), qty: Number(r.qty ?? 0) }));
    },
  },
  {
    id: 'sales_by_customer',
    titleEn: 'Sales by customer',
    titleUr: 'گاہک کے مطابق فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('customer', 'Customer', 'گاہک', 'text'),
      col('bills', 'Bills', 'بل', 'number'),
      col('total', 'Total', 'کل', 'money'),
      col('paid', 'Paid', 'ادا شدہ', 'money'),
      col('credit', 'Credit', 'ادھار', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT COALESCE(s.customer_name, 'Walk-in') AS customer, COUNT(*) AS bills,
                  COALESCE(SUM(s.total_paisa),0) AS total,
                  COALESCE(SUM(s.paid_paisa),0) AS paid,
                  COALESCE(SUM(s.credit_paisa),0) AS credit
           FROM sales s WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?
           GROUP BY customer ORDER BY total DESC LIMIT 300`,
          [range.from, range.to],
        )
      ).map(r => ({
        customer: String(r.customer ?? ''),
        bills: Number(r.bills ?? 0),
        total: Number(r.total ?? 0),
        paid: Number(r.paid ?? 0),
        credit: Number(r.credit ?? 0),
      })),
  },
  {
    id: 'sales_by_method',
    titleEn: 'Sales by payment method',
    titleUr: 'ادائیگی طریقے کے مطابق فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('method', 'Method', 'طریقہ', 'text'),
      col('count', 'Payments', 'ادائیگیاں', 'number'),
      col('amount', 'Amount', 'رقم', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT m.name_en AS method, COUNT(*) AS count, COALESCE(SUM(p.amount_paisa),0) AS amount
           FROM payments p JOIN payment_methods m ON m.id = p.method_id
           WHERE p.is_void = 0 AND p.direction = 'in' AND p.paid_at >= ? AND p.paid_at <= ?
           GROUP BY m.name_en ORDER BY amount DESC`,
          [range.from, range.to],
        )
      ).map(r => ({ method: String(r.method ?? ''), count: Number(r.count ?? 0), amount: Number(r.amount ?? 0) })),
  },
  {
    id: 'sales_by_cashier',
    titleEn: 'Sales by cashier',
    titleUr: 'کیشئر کے مطابق فروخت',
    group: 'sales',
    needsRange: true,
    columns: [
      col('cashier', 'Cashier', 'کیشئر', 'text'),
      col('bills', 'Bills', 'بل', 'number'),
      col('total', 'Total', 'کل', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT COALESCE(s.created_by, 'unknown') AS cashier, COUNT(*) AS bills,
                  COALESCE(SUM(s.total_paisa),0) AS total
           FROM sales s WHERE ${SALES_POSTED} AND s.sold_at >= ? AND s.sold_at <= ?
           GROUP BY cashier ORDER BY total DESC`,
          [range.from, range.to],
        )
      ).map(r => ({ cashier: String(r.cashier ?? ''), bills: Number(r.bills ?? 0), total: Number(r.total ?? 0) })),
  },
  {
    id: 'discounts',
    titleEn: 'Discount report',
    titleUr: 'رعایت رپورٹ',
    group: 'sales',
    needsRange: true,
    columns: [
      col('invoice_no', 'Invoice', 'رسید', 'text'),
      col('sold_at', 'Date', 'تاریخ', 'date'),
      col('customer', 'Customer', 'گاہک', 'text'),
      col('subtotal', 'Subtotal', 'ذیلی میزان', 'money'),
      col('discount', 'Discount', 'رعایت', 'money'),
      col('total', 'Total', 'کل', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT invoice_no, sold_at, COALESCE(customer_name, 'Walk-in') AS customer,
                  subtotal_paisa AS subtotal, discount_paisa AS discount, total_paisa AS total            FROM sales s WHERE ${SALES_POSTED} AND discount_paisa > 0 AND sold_at >= ? AND sold_at <= ?
           ORDER BY sold_at DESC LIMIT 500`,
          [range.from, range.to],
        )
      ).map(r => ({
        invoice_no: String(r.invoice_no ?? ''),
        sold_at: String(r.sold_at ?? ''),
        customer: String(r.customer ?? ''),
        subtotal: Number(r.subtotal ?? 0),
        discount: Number(r.discount ?? 0),
        total: Number(r.total ?? 0),
      })),
  },
  {
    id: 'returns',
    titleEn: 'Returns and credit notes',
    titleUr: 'واپسی اور کریڈٹ نوٹ',
    group: 'sales',
    needsRange: true,
    columns: [
      col('doc_no', 'Document', 'دستاویز', 'text'),
      col('type', 'Type', 'قسم', 'text'),
      col('original_no', 'Original', 'اصل', 'text'),
      col('party', 'Party', 'فریق', 'text'),
      col('returned_at', 'Date', 'تاریخ', 'date'),
      col('total', 'Amount', 'رقم', 'money'),
      col('reason', 'Reason', 'وجہ', 'text'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT doc_no, type, original_no, COALESCE(party_name, '') AS party, returned_at, total_paisa AS total, reason
           FROM returns WHERE status = 'posted' AND returned_at >= ? AND returned_at <= ?
           ORDER BY returned_at DESC LIMIT 500`,
          [range.from, range.to],
        )
      ).map(r => ({
        doc_no: String(r.doc_no ?? ''),
        type: String(r.type ?? ''),
        original_no: String(r.original_no ?? ''),
        party: String(r.party ?? ''),
        returned_at: String(r.returned_at ?? ''),
        total: Number(r.total ?? 0),
        reason: String(r.reason ?? ''),
      })),
  },
  {
    id: 'purchases_by_supplier',
    titleEn: 'Purchases by supplier',
    titleUr: 'سپلائر کے مطابق خریداری',
    group: 'purchases',
    needsRange: true,
    columns: [
      col('supplier', 'Supplier', 'سپلائر', 'text'),
      col('docs', 'Documents', 'دستاویزات', 'number'),
      col('total', 'Total', 'کل', 'money'),
      col('paid', 'Paid', 'ادا شدہ', 'money'),
      col('unpaid', 'Unpaid', 'بقایا', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT COALESCE(supplier_name, 'Cash purchase') AS supplier, COUNT(*) AS docs,
                  COALESCE(SUM(total_paisa),0) AS total, COALESCE(SUM(paid_paisa),0) AS paid
           FROM purchases WHERE status = 'posted' AND purchased_at >= ? AND purchased_at <= ?
           GROUP BY supplier ORDER BY total DESC`,
          [range.from, range.to],
        )
      ).map(r => ({
        supplier: String(r.supplier ?? ''),
        docs: Number(r.docs ?? 0),
        total: Number(r.total ?? 0),
        paid: Number(r.paid ?? 0),
        unpaid: Number(r.total ?? 0) - Number(r.paid ?? 0),
      })),
  },
  {
    id: 'purchases_by_product',
    titleEn: 'Purchases by product',
    titleUr: 'مصنوعات کے مطابق خریداری',
    group: 'purchases',
    needsRange: true,
    columns: [
      col('product', 'Product', 'مصنوعات', 'text'),
      col('qty', 'Quantity', 'مقدار', 'qty'),
      col('unit', 'Unit', 'یونٹ', 'unit'),
      col('total', 'Total', 'کل', 'money'),
      col('avg_cost', 'Cost / unit', 'فی یونٹ لاگت', 'money'),
    ],
    run: async (db, range) => {
      const rows = await db.query(
        `SELECT l.product_name, SUM(l.base_qty_micro) AS qty, p.base_unit AS unit,
                SUM(l.line_total_paisa) AS total
         FROM purchase_lines l JOIN purchases pu ON pu.id = l.purchase_id
         LEFT JOIN products p ON p.id = l.product_id
         WHERE pu.status = 'posted' AND pu.purchased_at >= ? AND pu.purchased_at <= ?
         GROUP BY l.product_name, p.base_unit ORDER BY total DESC LIMIT 300`,
        [range.from, range.to],
      );
      return rows.map(r => ({
        product: String(r.product_name ?? ''),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? ''),
        total: Number(r.total ?? 0),
        avg_cost: Number(r.qty ?? 0) > 0 ? mulDivRound(Number(r.total ?? 0), QTY_SCALE, Number(r.qty ?? 0)) : 0,
      }));
    },
  },
  {
    id: 'stock_current',
    titleEn: 'Current stock valuation',
    titleUr: 'موجودہ اسٹاک ویلیو',
    group: 'inventory',
    needsRange: false,
    columns: [
      col('code', 'Code', 'کوڈ', 'text'),
      col('product', 'Product', 'مصنوعات', 'text'),
      col('stock', 'Stock', 'اسٹاک', 'qty'),
      col('unit', 'Unit', 'یونٹ', 'unit'),
      col('cost', 'Cost / unit', 'فی یونٹ لاگت', 'money'),
      col('value', 'Stock value', 'اسٹاک ویلیو', 'money'),
      col('price', 'Sale price', 'قیمت', 'money'),
    ],
    run: async db => {
      const rows = await db.query(
        `SELECT code, name_en AS product, stock_micro AS stock, base_unit AS unit, cost_paisa AS cost,
                sale_price_paisa AS price, stock_micro AS stock_raw
         FROM products WHERE archived_at IS NULL AND is_active = 1 ORDER BY name_en LIMIT 2000`,
      );
      return rows.map(r => ({
        code: String(r.code ?? ''),
        product: String(r.product ?? ''),
        stock: Number(r.stock ?? 0),
        unit: String(r.unit ?? ''),
        cost: Number(r.cost ?? 0),
        value: mulDivRound(Number(r.stock_raw ?? 0), Number(r.cost ?? 0), QTY_SCALE),
        price: Number(r.price ?? 0),
      }));
    },
  },
  {
    id: 'stock_low',
    titleEn: 'Low stock',
    titleUr: 'کم اسٹاک',
    group: 'inventory',
    needsRange: false,
    columns: [
      col('product', 'Product', 'مصنوعات', 'text'),
      col('stock', 'Stock', 'اسٹاک', 'qty'),
      col('min_stock', 'Minimum', 'کم از کم', 'qty'),
      col('unit', 'Unit', 'یونٹ', 'unit'),
    ],
    run: async db =>
      (
        await db.query(
          `SELECT name_en AS product, stock_micro AS stock, min_stock_micro AS min_stock, base_unit AS unit
           FROM products WHERE archived_at IS NULL AND is_active = 1 AND stock_micro <= min_stock_micro
           ORDER BY stock_micro ASC LIMIT 500`,
        )
      ).map(r => ({
        product: String(r.product ?? ''),
        stock: Number(r.stock ?? 0),
        min_stock: Number(r.min_stock ?? 0),
        unit: String(r.unit ?? ''),
      })),
  },
  {
    id: 'stock_movements',
    titleEn: 'Stock movements',
    titleUr: 'اسٹاک حرکات',
    group: 'inventory',
    needsRange: true,
    columns: [
      col('moved_at', 'Date', 'تاریخ', 'date'),
      col('product', 'Product', 'مصنوعات', 'text'),
      col('type', 'Type', 'قسم', 'text'),
      col('qty', 'Quantity', 'مقدار', 'qty'),
      col('unit', 'Unit', 'یونٹ', 'unit'),
      col('doc_no', 'Document', 'دستاویز', 'text'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT m.moved_at, p.name_en AS product, m.type, m.qty_micro AS qty, p.base_unit AS unit, m.doc_no
           FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id
           WHERE m.moved_at >= ? AND m.moved_at <= ? ORDER BY m.moved_at DESC LIMIT 1000`,
          [range.from, range.to],
        )
      ).map(r => ({
        moved_at: String(r.moved_at ?? ''),
        product: String(r.product ?? ''),
        type: String(r.type ?? ''),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? ''),
        doc_no: String(r.doc_no ?? ''),
      })),
  },
  {
    id: 'expenses_by_category',
    titleEn: 'Expenses by category',
    titleUr: 'زمرے کے مطابق اخراجات',
    group: 'financial',
    needsRange: true,
    columns: [
      col('category', 'Category', 'زمرہ', 'text'),
      col('count', 'Entries', 'اندراج', 'number'),
      col('cash', 'Cash', 'نقد', 'money'),
      col('total', 'Total', 'کل', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT c.name_en AS category, COUNT(*) AS count,
                  COALESCE(SUM(CASE WHEN e.is_cash = 1 THEN e.amount_paisa ELSE 0 END),0) AS cash,
                  COALESCE(SUM(e.amount_paisa),0) AS total
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           WHERE e.status = 'posted' AND e.spent_at >= ? AND e.spent_at <= ?
           GROUP BY c.name_en ORDER BY total DESC`,
          [range.from, range.to],
        )
      ).map(r => ({
        category: String(r.category ?? ''),
        count: Number(r.count ?? 0),
        cash: Number(r.cash ?? 0),
        total: Number(r.total ?? 0),
      })),
  },
  {
    id: 'profit',
    titleEn: 'Profit summary',
    titleUr: 'منافع کا خلاصہ',
    group: 'financial',
    needsRange: true,
    columns: [
      col('label', 'Item', 'مد', 'text'),
      col('amount', 'Amount', 'رقم', 'money'),
      col('note', 'Basis', 'بنیاد', 'text'),
    ],
    run: async (db, range) => {
      const p = await profitReport(db, range);
      return [
        { label: 'Net sales', amount: p.netSalesPaisa, note: 'Gross sales - discounts - returns' },
        { label: 'Cost of goods sold', amount: p.cogsPaisa, note: 'Weighted average cost at sale time' },
        { label: 'Gross profit', amount: p.grossProfitPaisa, note: 'Net sales - COGS' },
        { label: 'Operating expenses', amount: p.expensesPaisa, note: 'Recorded expenses in period' },
        { label: 'Estimated operating profit', amount: p.operatingProfitPaisa, note: 'Excludes owner drawings, loans, depreciation' },
        { label: 'Bills', amount: p.billCount, note: 'Posted invoices' },
      ];
    },
  },
  {
    id: 'cash_flow',
    titleEn: 'Cash flow',
    titleUr: 'نقدی بہاؤ',
    group: 'financial',
    needsRange: true,
    columns: [
      col('source', 'Source', 'ذریعہ', 'text'),
      col('inflow', 'In', 'آمد', 'money'),
      col('outflow', 'Out', 'اخراج', 'money'),
      col('net', 'Net', 'خالص', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT source_type AS source,
                  COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END),0) AS inflow,
                  COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END),0) AS outflow
           FROM cash_movements WHERE moved_at >= ? AND moved_at <= ?
           GROUP BY source_type ORDER BY inflow DESC`,
          [range.from, range.to],
        )
      ).map(r => ({
        source: String(r.source ?? ''),
        inflow: Number(r.inflow ?? 0),
        outflow: Number(r.outflow ?? 0),
        net: Number(r.inflow ?? 0) - Number(r.outflow ?? 0),
      })),
  },
  {
    id: 'receivables',
    titleEn: 'Customer receivables',
    titleUr: 'گاہکوں سے وصولیاں',
    group: 'financial',
    needsRange: false,
    columns: [
      col('customer', 'Customer', 'گاہک', 'text'),
      col('phone', 'Phone', 'فون', 'text'),
      col('balance', 'Outstanding', 'بقایا', 'money'),
      col('limit', 'Credit limit', 'حد', 'money'),
    ],
    run: async db =>
      (
        await db.query(
          `SELECT name_en AS customer, COALESCE(phone,'') AS phone, balance_paisa AS balance,
                  credit_limit_paisa AS "limit"
           FROM customers WHERE balance_paisa <> 0 AND is_active = 1 ORDER BY balance_paisa DESC LIMIT 500`,
        )
      ).map(r => ({
        customer: String(r.customer ?? ''),
        phone: String(r.phone ?? ''),
        balance: Number(r.balance ?? 0),
        limit: Number(r.limit ?? 0),
      })),
  },
  {
    id: 'payables',
    titleEn: 'Supplier payables',
    titleUr: 'سپلائر واجبات',
    group: 'financial',
    needsRange: false,
    columns: [
      col('supplier', 'Supplier', 'سپلائر', 'text'),
      col('phone', 'Phone', 'فون', 'text'),
      col('balance', 'Outstanding', 'بقایا', 'money'),
    ],
    run: async db =>
      (
        await db.query(
          `SELECT name_en AS supplier, COALESCE(phone,'') AS phone, balance_paisa AS balance
           FROM suppliers WHERE balance_paisa <> 0 AND is_active = 1 ORDER BY balance_paisa DESC LIMIT 500`,
        )
      ).map(r => ({
        supplier: String(r.supplier ?? ''),
        phone: String(r.phone ?? ''),
        balance: Number(r.balance ?? 0),
      })),
  },
  {
    id: 'cash_closings',
    titleEn: 'Cash closings',
    titleUr: 'نقدی اختتام',
    group: 'financial',
    needsRange: true,
    columns: [
      col('closed_at', 'Closed', 'اختتام', 'date'),
      col('opening', 'Opening', 'ابتدائی', 'money'),
      col('expected', 'Expected', 'متوقع', 'money'),
      col('counted', 'Counted', 'گنی گئی', 'money'),
      col('difference', 'Difference', 'فرق', 'money'),
    ],
    run: async (db, range) =>
      (
        await db.query(
          `SELECT closed_at, opening_cash_paisa AS opening, expected_cash_paisa AS expected,
                  COALESCE(counted_cash_paisa,0) AS counted, COALESCE(difference_paisa,0) AS difference
           FROM shifts WHERE status = 'closed' AND closed_at >= ? AND closed_at <= ?
           ORDER BY closed_at DESC`,
          [range.from, range.to],
        )
      ).map(r => ({
        closed_at: String(r.closed_at ?? ''),
        opening: Number(r.opening ?? 0),
        expected: Number(r.expected ?? 0),
        counted: Number(r.counted ?? 0),
        difference: Number(r.difference ?? 0),
      })),
  },
];

export function listReports(): ReportDefinition[] {
  return REPORTS;
}

export function findReport(id: string): ReportDefinition | undefined {
  return REPORTS.find(r => r.id === id);
}

export async function runReport(db: Database, id: string, range: DateRange): Promise<ReportRow[]> {
  const def = findReport(id);
  if (!def) {throw new Error(`Unknown report: ${id}`);}
  return def.run(db, range);
}

function csvCell(value: string | number | null, kind: ReportValueKind): string {
  if (value === null || value === undefined) {return '';}
  if (kind === 'money') {return (Number(value) / 100).toFixed(2);}
  if (kind === 'qty') {return (Number(value) / QTY_SCALE).toFixed(3).replace(/\.?0+$/, '');}
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM keeps Urdu readable when the CSV is opened in Excel. */
export function reportToCsv(
  def: ReportDefinition,
  rows: ReportRow[],
  opts: { language?: 'en' | 'ur'; meta?: string[] } = {},
): string {
  const lang = opts.language ?? 'en';
  const header = def.columns.map(c => (lang === 'ur' ? c.labelUr : c.labelEn));
  const lines: string[] = [];
  if (opts.meta?.length) {
    for (const line of opts.meta) {lines.push(csvCell(line, 'text'));}
    lines.push('');
  }
  lines.push(header.map(h => csvCell(h, 'text')).join(','));
  for (const row of rows) {
    lines.push(def.columns.map(c => csvCell(row[c.key] ?? null, c.kind)).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
