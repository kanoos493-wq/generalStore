/**
 * The database side of first-run setup: a brand new database must report
 * "not set up" (so the app shows the wizard instead of a PIN prompt), and the
 * wizard's result must survive a restart.
 */
import { loadSettings, setSettings } from '../../src/services/settingsService';
import { loadDashboard } from '../../src/services/dashboardService';
import { listProducts } from '../../src/services/productService';
import { listReports, profitReport, runReport } from '../../src/services/reportService';
import { DEFAULT_SETTINGS } from '../../src/db/seed';
import { dayRange } from '../../src/core/dates';
import { cleanup, makeDb } from '../support/testDb';

describe('first-run flag', () => {
  afterEach(cleanup);

  it('ships with setup_completed = 0', () => {
    expect(DEFAULT_SETTINGS.setup_completed).toBe('0');
  });

  it('marks a brand new database as not set up', async () => {
    const { db } = await makeDb();
    const settings = await loadSettings(db);
    expect(settings.setupCompleted).toBe(false);
    // A new shop has no PIN yet, and the wizard (not the lock screen) collects it.
    expect(settings.pinEnabled).toBe(true);
  });

  it('persists the wizard result and opens without a PIN when none was set', async () => {
    const { db } = await makeDb();
    await db.tx(tx =>
      setSettings(tx, {
        store_name: 'Al-Madina Store',
        store_name_ur: 'المدینہ اسٹور',
        operator_name: 'Noor',
        pin_enabled: '0',
        setup_completed: '1',
      }),
    );

    const reopened = await loadSettings(db);
    expect(reopened.setupCompleted).toBe(true);
    expect(reopened.storeName).toBe('Al-Madina Store');
    expect(reopened.storeNameUr).toBe('المدینہ اسٹور');
    expect(reopened.operatorName).toBe('Noor');
    expect(reopened.pinEnabled).toBe(false);
  });

  it('opens every first screen on an empty shop without crashing or inventing numbers', async () => {
    const { db } = await makeDb();
    const range = dayRange();

    const dashboard = await loadDashboard(db, range);
    expect(dashboard.sales.grossSalesPaisa).toBe(0);
    expect(dashboard.sales.netSalesPaisa).toBe(0);
    expect(dashboard.sales.billCount).toBe(0);
    expect(dashboard.profit.grossProfitPaisa).toBe(0);
    expect(dashboard.cash.expectedPaisa).toBe(0);
    expect(dashboard.stockValuePaisa).toBe(0);
    expect(dashboard.stockItemCount).toBe(0);
    expect(dashboard.lowStock).toHaveLength(0);
    expect(dashboard.trend).toHaveLength(0);
    expect(dashboard.recentSales).toHaveLength(0);
    expect(dashboard.lastClosing).toBeNull();

    expect(await listProducts(db, {})).toHaveLength(0);
    expect(listReports().length).toBeGreaterThan(0);

    const profit = await profitReport(db, range);
    expect(profit.netSalesPaisa).toBe(0);
    expect(profit.grossProfitPaisa).toBe(0);
    expect(Number.isNaN(profit.operatingProfitPaisa)).toBe(false);

    // Every report must be runnable on a shop with no data yet.
    for (const report of listReports()) {
      const rows = await runReport(db, report.id, range);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it('keeps Urdu store names intact (no mojibake on write/read)', async () => {
    const { db } = await makeDb();
    await db.tx(tx => setSettings(tx, { store_name_ur: 'نور کریانہ اسٹور' }));
    const settings = await loadSettings(db);
    expect(settings.storeNameUr).toBe('نور کریانہ اسٹور');
  });
});
