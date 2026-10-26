import { QTY_SCALE } from '../../src/core/money';
import { createProduct } from '../../src/services/productService';
import { createParty } from '../../src/services/partyService';
import { createPurchase } from '../../src/services/purchaseService';
import { createSale } from '../../src/services/salesService';
import { closeShift, openShift } from '../../src/services/cashService';
import { makeDb, cleanup, owner, cashier } from '../support/testDb';
import type { Database } from '../../src/db/database';

const micro = (n: number) => Math.round(n * QTY_SCALE);

let database: Database;
let sugarId: string;
let supplierId: string;
let customerId: string;

beforeAll(async () => {
  const made = await makeDb();
  database = made.db;

  sugarId = await createProduct(database, {
    nameEn: 'Sugar',
    nameUr: 'چینی',
    code: 'SUGAR-1',
    barcode: '1000001',
    baseUnit: 'kg',
    salePricePaisa: 15000,
    minStockMicro: micro(10),
    units: [
      { unitCode: 'bag', kind: 'purchase', factorMicro: micro(10) },
      { unitCode: 'bag', kind: 'sale', factorMicro: micro(10) },
      { unitCode: 'g', kind: 'sale', factorMicro: micro(0.001) },
    ],
    actor: owner,
  });

  supplierId = await createParty(
    database,
    'supplier',
    { nameEn: 'Karachi Wholesale', phone: '03001234567', openingBalancePaisa: 0 },
    owner,
  );

  customerId = await createParty(
    database,
    'customer',
    { nameEn: 'Ali Raza', nameUr: 'علی رضا', phone: '03211234567', creditLimitPaisa: 1000000 },
    owner,
  );

  // 4 bags + 4 kg = 44 kg for 4 x PKR 1200 + 4 x PKR 120 = PKR 5,280
  await createPurchase(database, {
    supplierId,
    lines: [
      { productId: sugarId, unitCode: 'bag', qtyMicro: micro(4), unitCostPaisa: 120000 },
      { productId: sugarId, unitCode: 'kg', qtyMicro: micro(4), unitCostPaisa: 12000 },
    ],
    actor: owner,
  });
});

afterAll(async () => {
  await database.close();
  cleanup();
});

describe('mixed unit purchasing', () => {
  it('records 44 kg of stock from 4 bags + 4 kg', async () => {
    const product = await database.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [
      sugarId,
    ]);
    expect(Number(product!.stock_micro)).toBe(micro(44));
  });

  it('derives the weighted average cost of PKR 120/kg', async () => {
    const product = await database.one<{ cost_paisa: number }>('SELECT cost_paisa FROM products WHERE id = ?', [
      sugarId,
    ]);
    expect(Number(product!.cost_paisa)).toBe(12000);
  });

  it('records supplier debt of PKR 5,280 and a stock movement per line', async () => {
    const supplier = await database.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM suppliers WHERE id = ?',
      [supplierId],
    );
    expect(Number(supplier!.balance_paisa)).toBe(528000);
    const moves = await database.query('SELECT * FROM stock_movements WHERE product_id = ?', [sugarId]);
    expect(moves).toHaveLength(2);
    expect(moves.every(m => m.type === 'purchase')).toBe(true);
  });
});

describe('POS sales', () => {
  it('sells 500 g, deducting 0.5 kg and charging PKR 75', async () => {
    const result = await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'g', qtyMicro: micro(500) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 10000 }],
      actor: cashier,
    });
    expect(result.totalPaisa).toBe(7500);
    expect(result.paidPaisa).toBe(7500);
    expect(result.changePaisa).toBe(2500);
    expect(result.creditPaisa).toBe(0);
    expect(result.invoiceNo).toMatch(/^INV-\d{8}-\d{4}$/);

    const product = await database.one<{ stock_micro: number }>(
      'SELECT stock_micro FROM products WHERE id = ?',
      [sugarId],
    );
    expect(Number(product!.stock_micro)).toBe(micro(43.5));

    const line = await database.one<{ base_qty_micro: number; unit_price_paisa: number; unit_cost_paisa: number; cogs_paisa: number }>(
      'SELECT * FROM sale_lines WHERE sale_id = ?',
      [result.saleId],
    );
    expect(Number(line!.base_qty_micro)).toBe(micro(0.5));
    expect(Number(line!.unit_price_paisa)).toBe(15);
    expect(Number(line!.unit_cost_paisa)).toBe(12000);
    expect(Number(line!.cogs_paisa)).toBe(6000); // 0.5 kg * 120
  });

  it('records cash drawer inflow and no customer ledger for walk-in sales', async () => {
    const cash = await database.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'in' AND source_type = 'sale'`,
    );
    expect(Number(cash)).toBe(7500);
    const ledger = await database.scalar<number>('SELECT COUNT(*) FROM ledger_entries');
    expect(Number(ledger)).toBe(1); // only the supplier opening/purchase entry
  });

  it('rejects a discount above the configured limit for a cashier', async () => {
    await expect(
      createSale(database, {
        lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
        discountPaisa: 5000,
        payments: [{ methodId: 'pm_cash', amountPaisa: 10000 }],
        actor: cashier,
      }),
    ).rejects.toThrow(/manager approval/i);
    const count = await database.scalar<number>(`SELECT COUNT(*) FROM sales`);
    expect(Number(count)).toBe(1);
  });

  it('blocks walk-in credit sales', async () => {
    await expect(
      createSale(database, {
        lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
        payments: [],
        actor: cashier,
      }),
    ).rejects.toThrow(/Walk-in sales must be paid in full/i);
  });

  it('creates a receivable and partial payment for a registered customer', async () => {
    const result = await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(10) }],
      customerId,
      payments: [{ methodId: 'pm_cash', amountPaisa: 50000 }],
      actor: cashier,
    });
    expect(result.totalPaisa).toBe(150000);
    expect(result.creditPaisa).toBe(100000);

    const customer = await database.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM customers WHERE id = ?',
      [customerId],
    );
    expect(Number(customer!.balance_paisa)).toBe(100000);

    const entries = await database.query(
      `SELECT * FROM ledger_entries WHERE party_type = 'customer' ORDER BY entry_at, rowid`,
    );
    expect(entries).toHaveLength(2);
    expect(Number(entries[0].debit_paisa)).toBe(150000);
    expect(Number(entries[1].credit_paisa)).toBe(50000);
    expect(Number(entries[1].balance_paisa)).toBe(100000);
  });

  it('splits a bill across cash and a digital wallet', async () => {
    const cashBefore = Number(
      await database.scalar<number>(
        `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE source_type = 'sale' AND direction = 'in'`,
      ),
    );
    const result = await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(2) }],
      customerId,
      payments: [
        { methodId: 'pm_cash', amountPaisa: 20000 },
        { methodId: 'pm_wallet', amountPaisa: 10000 },
      ],
      actor: cashier,
    });
    expect(result.totalPaisa).toBe(30000);
    expect(result.paidPaisa).toBe(30000);
    const payments = await database.query('SELECT * FROM payments WHERE doc_id = ?', [result.saleId]);
    expect(payments).toHaveLength(2);
    const cashAfter = Number(
      await database.scalar<number>(
        `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE source_type = 'sale' AND direction = 'in'`,
      ),
    );
    // only the cash part reaches the drawer; the wallet part never does
    expect(cashAfter - cashBefore).toBe(20000);
  });

  it('prevents duplicate invoices from a repeated submission', async () => {
    const clientRef = 'client-ref-1';
    const first = await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 15000 }],
      clientRef,
      actor: cashier,
    });
    const second = await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 15000 }],
      clientRef,
      actor: cashier,
    });
    expect(second.duplicate).toBe(true);
    expect(second.saleId).toBe(first.saleId);
    const count = await database.scalar<number>('SELECT COUNT(*) FROM sales WHERE client_ref = ?', [clientRef]);
    expect(Number(count)).toBe(1);
  });

  it('rolls back every write when stock is insufficient', async () => {
    const before = await database.scalar<number>('SELECT stock_micro FROM products WHERE id = ?', [sugarId]);
    const salesBefore = await database.scalar<number>('SELECT COUNT(*) FROM sales');
    const movesBefore = await database.scalar<number>('SELECT COUNT(*) FROM stock_movements');

    await expect(
      createSale(database, {
        lines: [
          { productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) },
          { productId: sugarId, unitCode: 'kg', qtyMicro: micro(1000) },
        ],
        payments: [{ methodId: 'pm_cash', amountPaisa: 20000000 }],
        actor: cashier,
      }),
    ).rejects.toThrow(/Insufficient stock/i);

    expect(await database.scalar<number>('SELECT stock_micro FROM products WHERE id = ?', [sugarId])).toBe(before);
    expect(await database.scalar<number>('SELECT COUNT(*) FROM sales')).toBe(salesBefore);
    expect(await database.scalar<number>('SELECT COUNT(*) FROM stock_movements')).toBe(movesBefore);
  });

  it('refuses sales above the customer credit limit', async () => {
    await expect(
      createSale(database, {
        lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(100) }],
        customerId,
        payments: [],
        actor: cashier,
      }),
    ).rejects.toThrow(/Credit limit exceeded/i);
  });
});

describe('cash drawer', () => {
  it('computes expected closing cash from movements only', async () => {
    const open = await database.one<{ id: string }>(
      `SELECT id FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    );
    if (open) {await closeShift(database, { countedPaisa: 0, notes: 'reset', actor: owner });}

    await openShift(database, { openingCashPaisa: 500000, actor: owner });
    await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 15000 }],
      actor: cashier,
    });
    await createSale(database, {
      lines: [{ productId: sugarId, unitCode: 'kg', qtyMicro: micro(1) }],
      payments: [{ methodId: 'pm_card', amountPaisa: 15000 }],
      actor: cashier,
    });
    const closed = await closeShift(database, { countedPaisa: 515000, notes: 'test', actor: owner });

    // opening 5,000 + cash sale 150 = 5,150 ; the card sale must not appear
    expect(closed.summary.expectedPaisa).toBe(515000);
    expect(closed.differencePaisa).toBe(0);
  });
});
