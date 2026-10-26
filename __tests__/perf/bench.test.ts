/**
 * Opt-in performance benchmark (run with `npm run test:bench`).
 *
 * It builds a synthetic but structurally realistic dataset (products, sales and
 * sale lines) in the real migrated schema and measures the queries the app
 * actually runs: keyset product pages, Urdu/English search, sales history pages
 * and the SQL behind the dashboard/report aggregates.
 *
 * The numbers printed here are the ones quoted in README.md / PROJECT_STATUS.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from '../../src/db/database';
import { listProducts, nextCursor } from '../../src/services/productService';
import { listSales } from '../../src/services/salesService';
import { salesSummary, profitReport } from '../../src/services/reportService';
import { makeDb, cleanup } from '../support/testDb';
import { QTY_SCALE } from '../../src/core/money';
import { nowIso } from '../../src/core/dates';

const PRODUCTS = Number(process.env.BENCH_PRODUCTS ?? 2000);
const SALES = Number(process.env.BENCH_SALES ?? 40000);
const LINES_PER_SALE = 3;

const run = process.env.BENCH === '1' ? describe : describe.skip;

const WORDS = ['Sugar', 'Flour', 'Rice', 'Tea', 'Milk', 'Oil', 'Soap', 'Salt', 'Dal', 'Masala'];
const URDU = ['چینی', 'آٹا', 'چاول', 'چائے', 'دودھ', 'تیل', 'صابن', 'نمک', 'دال', 'مصالحہ'];

function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  return fn().then(value => ({ ms: performance.now() - started, value }));
}

async function bulkInsert(db: Database, sqlHead: string, rows: (string | number | null)[][], perBatch = 400) {
  const started = performance.now();
  for (let i = 0; i < rows.length; i += perBatch) {
    const batch = rows.slice(i, i + perBatch);
    const placeholders = batch
      .map(() => `(${new Array(batch[0].length).fill('?').join(',')})`)
      .join(',');
    await db.tx(async tx => {
      await tx.exec(`${sqlHead} VALUES ${placeholders}`, batch.flat());
    });
  }
  return { rows: rows.length, ms: performance.now() - started };
}

run(`synthetic dataset: ${PRODUCTS} products, ${SALES} sales`, () => {
  jest.setTimeout(600_000);
  let db: Database;
  let dbPath: string;
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    const made = await makeDb();
    db = made.db;
    dbPath = made.path;
    const now = nowIso();

    const productRows: (string | number | null)[][] = [];
    for (let i = 0; i < PRODUCTS; i += 1) {
      const word = WORDS[i % WORDS.length];
      const urdu = URDU[i % URDU.length];
      const name = `${word} ${i}`;
      const blob = `${name.toLowerCase()} ${urdu} ${word.toLowerCase()}`;
      productRows.push([
        `p${i}`,
        `SKU-${i}`,
        name,
        `${urdu} ${i}`,
        `88000${String(i).padStart(6, '0')}`,
        'kg',
        12000 + (i % 50) * 100,
        10000,
        (i % 40) * QTY_SCALE,
        5 * QTY_SCALE,
        0,
        0,
        0,
        0,
        0,
        blob,
        now,
        now,
      ]);
    }
    const productInsert = await bulkInsert(
      db,
      `INSERT INTO products (id, code, name_en, name_ur, barcode, base_unit, sale_price_paisa, cost_paisa,
        stock_micro, min_stock_micro, target_stock_micro, reorder_qty_micro, track_expiry, tax_bp, is_active,
        search_blob, created_at, updated_at)`,
      productRows,
    );

    const day = 86_400_000;
    const saleRows: (string | number | null)[][] = [];
    const lineRows: (string | number | null)[][] = [];
    for (let i = 0; i < SALES; i += 1) {
      const at = new Date(Date.now() - (i % 365) * day).toISOString();
      const total = 5000 + (i % 97) * 250;
      saleRows.push([
        `s${i}`,
        `INV-${String(i).padStart(7, '0')}`,
        null,
        'Walk-in',
        at,
        total,
        0,
        0,
        total,
        total,
        0,
        'posted',
        null,
        at,
        at,
        null,
      ]);
      for (let l = 0; l < LINES_PER_SALE; l += 1) {
        const productId = `p${(i * LINES_PER_SALE + l) % PRODUCTS}`;
        lineRows.push([
          `sl${i}_${l}`,
          `s${i}`,
          productId,
          `Product ${productId}`,
          'kg',
          QTY_SCALE,
          QTY_SCALE,
          QTY_SCALE,
          5000,
          0,
          5000,
          4000,
          4000,
          0,
        ]);
      }
    }
    const saleInsert = await bulkInsert(
      db,
      `INSERT INTO sales (id, invoice_no, customer_id, customer_name, sold_at, subtotal_paisa, discount_paisa,
        tax_paisa, total_paisa, paid_paisa, credit_paisa, status, shift_id, created_at, created_by, notes)`,
      saleRows,
    );
    const lineInsert = await bulkInsert(
      db,
      `INSERT INTO sale_lines (id, sale_id, product_id, product_name, unit_code, qty_micro, factor_micro,
        base_qty_micro, unit_price_paisa, line_discount_paisa, line_total_paisa, unit_cost_paisa, cogs_paisa,
        returned_qty_micro)`,
      lineRows,
    );

    report.dataset = {
      products: productInsert.rows,
      sales: saleInsert.rows,
      saleLines: lineInsert.rows,
      insertRowsPerSecond: Math.round(
        ((productInsert.rows + saleInsert.rows + lineInsert.rows) /
          (productInsert.ms + saleInsert.ms + lineInsert.ms)) *
          1000,
      ),
      dbSizeMb: Number((fs.statSync(dbPath).size / 1048576).toFixed(2)),
    };
  });

  afterAll(async () => {
    await db.close();
    cleanup();
    console.log(`BENCH_RESULTS ${JSON.stringify(report, null, 2)}`);
    const out = path.join(process.cwd(), 'reports');
    if (fs.existsSync(out)) {
      fs.writeFileSync(path.join(out, 'bench-results.json'), JSON.stringify(report, null, 2));
    }
  });

  it('loads the first product page', async () => {
    const { ms, value } = await timed(() => listProducts(db, { limit: 40 }));
    expect(value).toHaveLength(40);
    report.productFirstPageMs = Number(ms.toFixed(1));
  });

  it('loads a deep product page with a keyset cursor', async () => {
    const first = await timed(() => listProducts(db, { limit: 40, sort: 'name' }));
    let cursor = nextCursor(first.value, 'name');
    let last = first;
    for (let page = 0; page < 20; page += 1) {
      last = await timed(() => listProducts(db, { limit: 40, sort: 'name', cursor }));
      cursor = nextCursor(last.value, 'name');
    }
    expect(last.value).toHaveLength(40);
    report.productDeepPage20Ms = Number(last.ms.toFixed(1));
  });

  it('searches English and Urdu names', async () => {
    const en = await timed(() => listProducts(db, { query: 'sugar 12', limit: 40 }));
    const ur = await timed(() => listProducts(db, { query: 'چینی', limit: 40 }));
    expect(en.value.length).toBeGreaterThan(0);
    expect(ur.value.length).toBeGreaterThan(0);
    report.searchEnglishMs = Number(en.ms.toFixed(1));
    report.searchUrduMs = Number(ur.ms.toFixed(1));
  });

  it('scans a barcode', async () => {
    const barcode = `88000${String(123).padStart(6, '0')}`;
    const { ms, value } = await timed(() => listProducts(db, { query: barcode, limit: 5 }));
    expect(value.length).toBeGreaterThan(0);
    report.barcodeLookupMs = Number(ms.toFixed(1));
  });

  it('pages the sales history', async () => {
    const first = await timed(() => listSales(db, { limit: 40 }));
    expect(first.value).toHaveLength(40);
    const deep = await timed(() =>
      listSales(db, {
        limit: 40,
        beforeSoldAt: first.value[first.value.length - 1].sold_at,
        beforeId: first.value[first.value.length - 1].id,
      }),
    );
    expect(deep.value).toHaveLength(40);
    report.salesHistoryFirstPageMs = Number(first.ms.toFixed(1));
    report.salesHistoryNextPageMs = Number(deep.ms.toFixed(1));
  });

  it('aggregates a month of sales and profit', async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const summary = await timed(() => salesSummary(db, { from, to }));
    const profit = await timed(() => profitReport(db, { from, to }));
    expect(summary.value).toBeTruthy();
    expect(profit.value).toBeTruthy();
    report.monthlySalesSummaryMs = Number(summary.ms.toFixed(1));
    report.monthlyProfitReportMs = Number(profit.ms.toFixed(1));
  });
});
