import { QTY_SCALE } from '../../src/core/money';
import { createProduct, listProducts, nextCursor, productByBarcode } from '../../src/services/productService';
import { createParty } from '../../src/services/partyService';
import { createPurchase } from '../../src/services/purchaseService';
import { createAdjustment, lowStockProducts, restockSuggestions } from '../../src/services/adjustmentService';
import { createExpense, listExpenses, voidExpense } from '../../src/services/expenseService';
import { createSale } from '../../src/services/salesService';
import { makeDb, cleanup, owner, cashier, inventory, accountant } from '../support/testDb';
import type { Database } from '../../src/db/database';

const micro = (n: number) => Math.round(n * QTY_SCALE);

let db: Database;
let productId: string;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  productId = await createProduct(db, {
    nameEn: 'Green Tea',
    nameUr: 'سبز چائے',
    code: 'TEA-01',
    barcode: '222333',
    baseUnit: 'piece',
    salePricePaisa: 15000,
    minStockMicro: micro(16),
    actor: owner,
  });
});

afterAll(async () => {
  await db.close();
  cleanup();
});

describe('stock adjustments', () => {
  it('records opening stock with a cost', async () => {
    await createAdjustment(db, {
      type: 'opening',
      reason: 'Opening stock count',
      lines: [{ productId, qtyMicro: micro(20), unitCostPaisa: 10000 }],
      actor: inventory,
    });
    const row = await db.one<{ stock_micro: number; cost_paisa: number }>(
      'SELECT stock_micro, cost_paisa FROM products WHERE id = ?',
      [productId],
    );
    expect(Number(row!.stock_micro)).toBe(micro(20));
    expect(Number(row!.cost_paisa)).toBe(10000);
    const moves = await db.query('SELECT * FROM stock_movements WHERE product_id = ?', [productId]);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('opening');
  });

  it('records a physical count difference against the system quantity', async () => {
    await createAdjustment(db, {
      type: 'count',
      reason: 'Monthly count',
      lines: [{ productId, countedQtyMicro: micro(18) }],
      actor: inventory,
    });
    const row = await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [productId]);
    expect(Number(row!.stock_micro)).toBe(micro(18));
    const line = await db.one<{ system_qty_micro: number; counted_qty_micro: number; base_qty_micro: number }>(
      'SELECT * FROM adjustment_lines ORDER BY rowid DESC LIMIT 1',
    );
    expect(Number(line!.system_qty_micro)).toBe(micro(20));
    expect(Number(line!.counted_qty_micro)).toBe(micro(18));
    expect(Number(line!.base_qty_micro)).toBe(micro(-2));
  });

  it('writes off damaged stock without going negative', async () => {
    await createAdjustment(db, {
      type: 'damage',
      reason: 'Crushed boxes',
      lines: [{ productId, qtyMicro: micro(3) }],
      actor: inventory,
    });
    const row = await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [productId]);
    expect(Number(row!.stock_micro)).toBe(micro(15));

    await expect(
      createAdjustment(db, {
        type: 'damage',
        reason: 'Too much',
        lines: [{ productId, qtyMicro: micro(99) }],
        actor: inventory,
      }),
    ).rejects.toThrow(/Insufficient stock/i);
  });

  it('requires a reason for every adjustment', async () => {
    await expect(
      createAdjustment(db, {
        type: 'damage',
        reason: '  ',
        lines: [{ productId, qtyMicro: micro(1) }],
        actor: inventory,
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('fills restock suggestions and flags low stock', async () => {
    const low = await lowStockProducts(db);
    expect(low.some(r => r.id === productId)).toBe(true);
    const suggestions = await restockSuggestions(db);
    expect(suggestions.some(r => r.id === productId)).toBe(true);
  });
});

describe('expenses', () => {
  it('records a cash expense and reflects it in the drawer', async () => {
    const before = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'out'`,
    );
    const created = await createExpense(db, {
      categoryId: 'exp_electricity',
      description: 'July bill',
      amountPaisa: 450000,
      methodId: 'pm_cash',
      actor: accountant,
    });
    expect(created.docNo).toMatch(/^EXP-/);
    const after = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'out'`,
    );
    expect(Number(after) - Number(before)).toBe(450000);
  });

  it('records a bank expense without touching the drawer', async () => {
    const before = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'out'`,
    );
    await createExpense(db, {
      categoryId: 'exp_rent',
      description: 'Shop rent',
      amountPaisa: 5000000,
      methodId: 'pm_bank',
      actor: accountant,
    });
    const after = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'out'`,
    );
    expect(Number(after)).toBe(Number(before));
    const expenses = await listExpenses(db);
    expect(expenses).toHaveLength(2);
  });

  it('voids an expense and reverses the cash movement', async () => {
    const before = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'in'`,
    );
    const created = await createExpense(db, {
      categoryId: 'exp_misc',
      description: 'Mistake',
      amountPaisa: 1000,
      methodId: 'pm_cash',
      actor: owner,
    });
    await voidExpense(db, { expenseId: created.id, reason: 'Wrong entry', actor: owner });
    const after = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'in'`,
    );
    expect(Number(after) - Number(before)).toBe(1000);
    const listed = await listExpenses(db);
    expect(listed.some(e => e.id === created.id)).toBe(false);
    const row = await db.one<{ status: string }>('SELECT status FROM expenses WHERE id = ?', [created.id]);
    expect(row!.status).toBe('void');
  });

  it('denies expense management to a cashier', async () => {
    await expect(
      createExpense(db, {
        categoryId: 'exp_misc',
        description: 'Nope',
        amountPaisa: 100,
        methodId: 'pm_cash',
        actor: cashier,
      }),
    ).rejects.toThrow(/Permission denied/i);
  });
});

describe('permissions are enforced in the service layer', () => {
  it('denies stock adjustments to a cashier', async () => {
    await expect(
      createAdjustment(db, {
        type: 'found',
        reason: 'found',
        lines: [{ productId, qtyMicro: micro(1) }],
        actor: cashier,
      }),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('denies purchases to an accountant', async () => {
    const supplierId = await createParty(db, 'supplier', { nameEn: 'Perm Supplier' }, owner);
    await expect(
      createPurchase(db, {
        supplierId,
        lines: [{ productId, unitCode: 'piece', qtyMicro: micro(1), unitCostPaisa: 100 }],
        actor: accountant,
      }),
    ).rejects.toThrow(/Permission denied/i);
  });
});

describe('search and pagination', () => {
  it('finds products by Urdu name, English name, code and barcode', async () => {
    expect((await listProducts(db, { query: 'سبز' })).map(p => p.id)).toContain(productId);
    expect((await listProducts(db, { query: 'green' })).map(p => p.id)).toContain(productId);
    expect((await listProducts(db, { query: 'TEA-01' })).map(p => p.id)).toContain(productId);
    expect((await listProducts(db, { query: '222333' })).map(p => p.id)).toContain(productId);
    const byBarcode = await productByBarcode(db, '222333');
    expect(byBarcode?.id).toBe(productId);
  });

  it('stores Urdu text without corrupting it', async () => {
    const row = await db.one<{ name_ur: string }>('SELECT name_ur FROM products WHERE id = ?', [productId]);
    expect(row!.name_ur).toBe('سبز چائے');
  });

  it('pages through products with a keyset cursor without gaps or duplicates', async () => {
    for (let i = 0; i < 55; i += 1) {
      await createProduct(db, {
        nameEn: `Bulk Item ${String(i).padStart(2, '0')}`,
        baseUnit: 'piece',
        salePricePaisa: 1000,
        actor: owner,
      });
    }
    const seen: string[] = [];
    let cursor: { after: string | number | null; afterId: string | null } | null = null;
    for (let page = 0; page < 10; page += 1) {
      const rows = await listProducts(db, { limit: 10, cursor, sort: 'name' });
      if (!rows.length) {break;}
      seen.push(...rows.map(r => r.id));
      cursor = nextCursor(rows, 'name');
    }
    expect(seen).toHaveLength(56);
    expect(new Set(seen).size).toBe(56);
    const firstPage = await listProducts(db, { limit: 10, sort: 'name' });
    expect(firstPage.map(p => p.name_en)).toContain('Bulk Item 00');
    const names = firstPage.map(p => p.name_en);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('sells a product with Urdu name resolution intact', async () => {
    const sale = await createSale(db, {
      lines: [{ productId, unitCode: 'piece', qtyMicro: micro(1) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 15000 }],
      actor: cashier,
    });
    const line = await db.one<{ product_name: string }>('SELECT product_name FROM sale_lines WHERE sale_id = ?', [
      sale.saleId,
    ]);
    expect(line!.product_name).toBe('Green Tea');
  });
});
