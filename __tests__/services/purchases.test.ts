import { QTY_SCALE } from '../../src/core/money';
import { createProduct } from '../../src/services/productService';
import { createParty, partyDetail } from '../../src/services/partyService';
import { createPurchase, purchaseDetail, voidPurchase } from '../../src/services/purchaseService';
import { createPurchaseReturn } from '../../src/services/returnService';
import { setSettings } from '../../src/services/settingsService';
import { makeDb, cleanup, owner, inventory } from '../support/testDb';
import type { Database } from '../../src/db/database';
import type { PurchaseLineRow } from '../../src/db/types';

const micro = (n: number) => Math.round(n * QTY_SCALE);

let db: Database;
let soapId: string;
let supplierId: string;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  soapId = await createProduct(db, {
    nameEn: 'Lifebuoy Soap',
    nameUr: 'لائف بوائے صابن',
    baseUnit: 'piece',
    salePricePaisa: 2000,
    units: [
      { unitCode: 'box', kind: 'purchase', factorMicro: micro(6) },
      { unitCode: 'carton', kind: 'purchase', factorMicro: micro(120) },
      { unitCode: 'box', kind: 'sale', factorMicro: micro(6) },
      { unitCode: 'carton', kind: 'sale', factorMicro: micro(120) },
    ],
    actor: owner,
  });
  supplierId = await createParty(db, 'supplier', { nameEn: 'Unilever Distributor' }, owner);
});

afterAll(async () => {
  await db.close();
  cleanup();
});

describe('mixed-unit purchases', () => {
  it('receives 3 cartons + 2 boxes + 5 pieces as 377 pieces', async () => {
    const result = await createPurchase(db, {
      supplierId,
      lines: [
        { productId: soapId, unitCode: 'carton', qtyMicro: micro(3), unitCostPaisa: 240000 },
        { productId: soapId, unitCode: 'box', qtyMicro: micro(2), unitCostPaisa: 12000 },
        { productId: soapId, unitCode: 'piece', qtyMicro: micro(5), unitCostPaisa: 2000 },
      ],
      payments: [{ methodId: 'pm_cash', amountPaisa: 500000 }],
      actor: inventory,
    });

    expect(result.totalPaisa).toBe(754000);
    expect(result.paidPaisa).toBe(500000);
    expect(result.payablePaisa).toBe(254000);

    const product = await db.one<{ stock_micro: number; cost_paisa: number }>(
      'SELECT stock_micro, cost_paisa FROM products WHERE id = ?',
      [soapId],
    );
    expect(Number(product!.stock_micro)).toBe(micro(377));
    expect(Number(product!.cost_paisa)).toBe(2000);
  });

  it('keeps the entered quantities and unit prices on the document', async () => {
    const purchases = await db.query('SELECT * FROM purchases ORDER BY created_at');
    const detail = await purchaseDetail(db, String(purchases[0].id));
    const lines = detail.lines as unknown as PurchaseLineRow[];
    expect(lines.map(l => Number(l.qty_micro))).toEqual([micro(3), micro(2), micro(5)]);
    expect(lines.map(l => Number(l.unit_cost_paisa))).toEqual([240000, 12000, 2000]);
    expect(lines.map(l => Number(l.cost_per_base_paisa))).toEqual([2000, 2000, 2000]);
  });

  it('reduces the supplier payable with the partial payment', async () => {
    const supplier = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM suppliers WHERE id = ?',
      [supplierId],
    );
    expect(Number(supplier!.balance_paisa)).toBe(254000);
  });

  it('returns one box to the supplier as a credit note', async () => {
    const purchases = await db.query('SELECT * FROM purchases ORDER BY created_at');
    const detail = await purchaseDetail(db, String(purchases[0].id));
    const boxLine = (detail.lines as unknown as PurchaseLineRow[]).find(l => l.unit_code === 'box')!;

    const result = await createPurchaseReturn(db, {
      purchaseId: String(purchases[0].id),
      lines: [{ purchaseLineId: boxLine.id, qtyMicro: micro(1) }],
      reason: 'Damaged packaging',
      actor: inventory,
    });

    expect(result.totalPaisa).toBe(12000);
    expect(result.creditNotePaisa).toBe(12000);

    const product = await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [soapId]);
    expect(Number(product!.stock_micro)).toBe(micro(371));

    const supplier = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM suppliers WHERE id = ?',
      [supplierId],
    );
    expect(Number(supplier!.balance_paisa)).toBe(242000);
  });

  it('cannot return more than was purchased on the line', async () => {
    const purchases = await db.query('SELECT * FROM purchases ORDER BY created_at');
    const detail = await purchaseDetail(db, String(purchases[0].id));
    const cartonLine = (detail.lines as unknown as PurchaseLineRow[]).find(l => l.unit_code === 'carton')!;
    await expect(
      createPurchaseReturn(db, {
        purchaseId: String(purchases[0].id),
        lines: [{ purchaseLineId: cartonLine.id, qtyMicro: micro(4) }],
        reason: 'too many',
        actor: inventory,
      }),
    ).rejects.toThrow(/exceeds/i);
  });
});

describe('costing method', () => {
  it('uses weighted average by default', async () => {
    const product = await createProduct(db, {
      nameEn: 'Rice',
      baseUnit: 'kg',
      salePricePaisa: 30000,
      actor: owner,
    });
    await createPurchase(db, {
      supplierId,
      lines: [{ productId: product, unitCode: 'kg', qtyMicro: micro(100), unitCostPaisa: 20000 }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 2000000 }],
      actor: inventory,
    });
    await createPurchase(db, {
      supplierId,
      lines: [{ productId: product, unitCode: 'kg', qtyMicro: micro(100), unitCostPaisa: 26000 }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 2600000 }],
      actor: inventory,
    });
    const row = await db.one<{ cost_paisa: number; stock_micro: number }>(
      'SELECT cost_paisa, stock_micro FROM products WHERE id = ?',
      [product],
    );
    expect(Number(row!.stock_micro)).toBe(micro(200));
    expect(Number(row!.cost_paisa)).toBe(23000);
  });

  it('can be switched to latest cost', async () => {
    await db.tx(tx => setSettings(tx, { valuation_method: 'latest' }));
    const product = await createProduct(db, {
      nameEn: 'Cooking Oil',
      baseUnit: 'l',
      salePricePaisa: 55000,
      actor: owner,
    });
    await createPurchase(db, {
      supplierId,
      lines: [{ productId: product, unitCode: 'l', qtyMicro: micro(10), unitCostPaisa: 40000 }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 400000 }],
      actor: inventory,
    });
    await createPurchase(db, {
      supplierId,
      lines: [{ productId: product, unitCode: 'l', qtyMicro: micro(10), unitCostPaisa: 46000 }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 460000 }],
      actor: inventory,
    });
    const row = await db.one<{ cost_paisa: number }>('SELECT cost_paisa FROM products WHERE id = ?', [product]);
    expect(Number(row!.cost_paisa)).toBe(46000);
    await db.tx(tx => setSettings(tx, { valuation_method: 'wac' }));
  });
});

describe('purchase reversal', () => {
  it('restores stock and clears the payable with an audited reversal', async () => {
    const product = await createProduct(db, {
      nameEn: 'Tea',
      baseUnit: 'kg',
      salePricePaisa: 100000,
      actor: owner,
    });
    const purchase = await createPurchase(db, {
      supplierId,
      lines: [{ productId: product, unitCode: 'kg', qtyMicro: micro(10), unitCostPaisa: 90000 }],
      actor: inventory,
    });
    const before = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM suppliers WHERE id = ?',
      [supplierId],
    );

    await voidPurchase(db, { purchaseId: purchase.purchaseId, reason: 'Wrong supplier', actor: owner });

    const after = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM suppliers WHERE id = ?',
      [supplierId],
    );
    expect(Number(after!.balance_paisa)).toBe(Number(before!.balance_paisa) - 900000);
    const stock = await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [product]);
    expect(Number(stock!.stock_micro)).toBe(0);
    const purchaseRow = await db.one<{ status: string }>('SELECT status FROM purchases WHERE id = ?', [
      purchase.purchaseId,
    ]);
    expect(purchaseRow!.status).toBe('reversed');

    const detail = await partyDetail(db, 'supplier', supplierId);
    expect(detail.payments.length).toBeGreaterThan(0);
  });
});
