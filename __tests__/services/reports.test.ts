import { QTY_SCALE } from '../../src/core/money';
import { createProduct } from '../../src/services/productService';
import { createParty } from '../../src/services/partyService';
import { createPurchase } from '../../src/services/purchaseService';
import { createSale, saleDetail } from '../../src/services/salesService';
import { createSaleReturn } from '../../src/services/returnService';
import { createExpense } from '../../src/services/expenseService';
import { openShift } from '../../src/services/cashService';
import { loadDashboard } from '../../src/services/dashboardService';
import { listReports, profitReport, reportToCsv, runReport } from '../../src/services/reportService';
import { dayRange } from '../../src/core/dates';
import { makeDb, cleanup, owner, cashier, manager } from '../support/testDb';
import type { Database } from '../../src/db/database';
import type { SaleLineRow } from '../../src/db/types';

const micro = (n: number) => Math.round(n * QTY_SCALE);

let db: Database;
let productId: string;
let customerId: string;
let supplierId: string;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  await openShift(db, { openingCashPaisa: 1000000, actor: owner });

  productId = await createProduct(db, {
    nameEn: 'Flour',
    nameUr: 'آٹا',
    baseUnit: 'kg',
    salePricePaisa: 10000,
    minStockMicro: micro(80),
    actor: owner,
  });
  supplierId = await createParty(db, 'supplier', { nameEn: 'Flour Mills' }, owner);
  customerId = await createParty(db, 'customer', { nameEn: 'Kiran' }, owner);

  await createPurchase(db, {
    supplierId,
    lines: [{ productId, unitCode: 'kg', qtyMicro: micro(100), unitCostPaisa: 6000 }],
    payments: [{ methodId: 'pm_cash', amountPaisa: 600000 }],
    actor: owner,
  });
  await createSale(db, {
    lines: [{ productId, unitCode: 'kg', qtyMicro: micro(30) }],
    payments: [{ methodId: 'pm_cash', amountPaisa: 300000 }],
    actor: cashier,
  });
  const creditSale = await createSale(db, {
    lines: [{ productId, unitCode: 'kg', qtyMicro: micro(20) }],
    customerId,
    payments: [{ methodId: 'pm_cash', amountPaisa: 50000 }],
    actor: cashier,
  });
  const detail = await saleDetail(db, creditSale.saleId);
  await createSaleReturn(db, {
    saleId: creditSale.saleId,
    lines: [{ saleLineId: (detail.lines[0] as SaleLineRow).id, qtyMicro: micro(5) }],
    reason: 'wet bags',
    actor: manager,
  });
  await createExpense(db, {
    categoryId: 'exp_transport',
    description: 'Delivery van fuel',
    amountPaisa: 70000,
    methodId: 'pm_cash',
    actor: owner,
  });
});

afterAll(async () => {
  await db.close();
  cleanup();
});

describe('profit reconciliation', () => {
  it('computes net sales, COGS and operating profit from documents', async () => {
    const p = await profitReport(db, dayRange());
    expect(p.netSalesPaisa).toBe(450000); // 5,000 sales - 500 return
    expect(p.cogsPaisa).toBe(270000); // 45 kg sold net at 60
    expect(p.grossProfitPaisa).toBe(180000);
    expect(p.expensesPaisa).toBe(70000);
    expect(p.operatingProfitPaisa).toBe(110000);
  });

  it('does not treat purchases as cost of goods sold', async () => {
    const p = await profitReport(db, dayRange());
    expect(p.cogsPaisa).not.toBe(600000);
  });
});

describe('dashboard', () => {
  it('matches the underlying ledgers and stock', async () => {
    const dash = await loadDashboard(db, dayRange());
    expect(dash.sales.grossSalesPaisa).toBe(500000);
    expect(dash.sales.returnsPaisa).toBe(50000);
    expect(dash.sales.netSalesPaisa).toBe(450000);
    expect(dash.sales.creditPaisa).toBe(150000);
    expect(dash.stockItemCount).toBe(1);
    expect(dash.stockQtyMicro).toBe(micro(55));
    expect(dash.stockValuePaisa).toBe(330000);
    expect(dash.receivablesPaisa).toBe(100000);
    expect(dash.payablesPaisa).toBe(0);
    expect(dash.lowStockCount).toBe(1);
    expect(dash.cash.expectedPaisa).toBe(1000000 + 350000 - 600000 - 70000);
    expect(dash.purchasesPaisa).toBe(600000);
    expect(dash.profit.operatingProfitPaisa).toBe(110000);
  });

  it('lists the best selling products from posted sales', async () => {
    const dash = await loadDashboard(db, dayRange());
    expect(dash.topProducts[0].productName).toBe('Flour');
    expect(dash.topProducts[0].qtyMicro).toBe(micro(50));
    expect(dash.trend.length).toBe(1);
    expect(dash.recentSales.length).toBe(2);
  });
});

describe('report catalogue', () => {
  it('exposes every report with unique ids and runnable columns', async () => {
    const reports = listReports();
    const ids = new Set(reports.map(r => r.id));
    expect(ids.size).toBe(reports.length);
    expect(reports.length).toBeGreaterThanOrEqual(15);
    for (const report of reports) {
      const rows = await runReport(db, report.id, dayRange());
      expect(Array.isArray(rows)).toBe(true);
      for (const row of rows) {
        for (const column of report.columns) {
          expect(row).toHaveProperty(column.key);
        }
      }
    }
  });

  it('reconciles sales-by-day totals with the raw invoice totals', async () => {
    const rows = await runReport(db, 'sales_daily', dayRange());
    const net = rows.reduce((sum, r) => sum + Number(r.net ?? 0), 0);
    expect(net).toBe(450000);
  });

  it('reports stock valuation that equals quantity x average cost', async () => {
    const rows = await runReport(db, 'stock_current', dayRange());
    const row = rows.find(r => r.product === 'Flour')!;
    expect(Number(row.stock)).toBe(micro(55));
    expect(Number(row.value)).toBe(330000);
  });

  it('reports receivables per customer', async () => {
    const rows = await runReport(db, 'receivables', dayRange());
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].balance)).toBe(100000);
  });

  it('exports UTF-8 CSV with a BOM and Urdu headers', async () => {
    const report = listReports().find(r => r.id === 'receivables')!;
    const csv = reportToCsv(report, await runReport(db, report.id, dayRange()), { language: 'ur' });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('گاہک');
    expect(csv).toContain('Kiran');
    expect(csv).toContain('1000.00');
  });
});
