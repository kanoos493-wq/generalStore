import { QTY_SCALE } from '../../src/core/money';
import { createProduct } from '../../src/services/productService';
import { createParty, partyStatement } from '../../src/services/partyService';
import { createPurchase } from '../../src/services/purchaseService';
import { createSale, saleDetail } from '../../src/services/salesService';
import { createSaleReturn } from '../../src/services/returnService';
import { receiveCustomerPayment } from '../../src/services/paymentService';
import { dayRange } from '../../src/core/dates';
import { makeDb, cleanup, owner, cashier, manager } from '../support/testDb';
import type { Database } from '../../src/db/database';
import type { SaleLineRow } from '../../src/db/types';

const micro = (n: number) => Math.round(n * QTY_SCALE);

let db: Database;
let riceId: string;
let customerId: string;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  riceId = await createProduct(db, {
    nameEn: 'Basmati Rice',
    nameUr: 'باسمتی چاول',
    baseUnit: 'kg',
    salePricePaisa: 25000,
    actor: owner,
  });
  const supplierId = await createParty(db, 'supplier', { nameEn: 'Rice Mill' }, owner);
  customerId = await createParty(db, 'customer', { nameEn: 'Hina', creditLimitPaisa: 10000000 }, owner);
  await createPurchase(db, {
    supplierId,
    lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(100), unitCostPaisa: 20000 }],
    payments: [{ methodId: 'pm_cash', amountPaisa: 2000000 }],
    actor: owner,
  });
});

afterAll(async () => {
  await db.close();
  cleanup();
});

describe('sales returns', () => {
  it('returns part of a paid invoice with a cash refund', async () => {
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(10) }],
      customerId,
      payments: [{ methodId: 'pm_cash', amountPaisa: 250000 }],
      actor: manager,
    });
    const detail = await saleDetail(db, sale.saleId);
    const line = detail.lines[0] as SaleLineRow;

    const ret = await createSaleReturn(db, {
      saleId: sale.saleId,
      lines: [{ saleLineId: line.id, qtyMicro: micro(2) }],
      refundMethodId: 'pm_cash',
      reason: 'Customer changed mind',
      actor: manager,
    });

    expect(ret.totalPaisa).toBe(50000);
    expect(ret.refundedPaisa).toBe(50000);

    const product = await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [riceId]);
    expect(Number(product!.stock_micro)).toBe(micro(92)); // 100 - 10 + 2

    const cashOut = await db.scalar<number>(
      `SELECT COALESCE(SUM(amount_paisa),0) FROM cash_movements WHERE direction = 'out' AND source_type = 'sale_refund'`,
    );
    expect(Number(cashOut)).toBe(50000);

    const updated = await db.one<{ returned_qty_micro: number }>(
      'SELECT returned_qty_micro FROM sale_lines WHERE id = ?',
      [line.id],
    );
    expect(Number(updated!.returned_qty_micro)).toBe(micro(2));

    // the original invoice is untouched
    const original = await db.one<{ total_paisa: number; status: string }>(
      'SELECT total_paisa, status FROM sales WHERE id = ?',
      [sale.saleId],
    );
    expect(Number(original!.total_paisa)).toBe(250000);
    expect(original!.status).toBe('posted');
  });

  it('refuses a cash refund larger than what the customer actually paid', async () => {
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(10) }],
      customerId,
      payments: [{ methodId: 'pm_cash', amountPaisa: 50000 }],
      actor: manager,
    });
    const detail = await saleDetail(db, sale.saleId);
    const line = detail.lines[0] as SaleLineRow;
    await expect(
      createSaleReturn(db, {
        saleId: sale.saleId,
        lines: [{ saleLineId: line.id, qtyMicro: micro(10) }],
        refundMethodId: 'pm_cash',
        reason: 'Full return',
        actor: manager,
      }),
    ).rejects.toThrow(/credit note/i);
  });

  it('issues a credit note that reduces the khata balance', async () => {
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(10) }],
      customerId,
      payments: [],
      actor: manager,
    });
    const before = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM customers WHERE id = ?',
      [customerId],
    );
    const detail = await saleDetail(db, sale.saleId);
    const line = detail.lines[0] as SaleLineRow;
    const ret = await createSaleReturn(db, {
      saleId: sale.saleId,
      lines: [{ saleLineId: line.id, qtyMicro: micro(4) }],
      reason: 'Quality issue',
      actor: manager,
    });
    expect(ret.creditNotePaisa).toBe(100000);

    const after = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM customers WHERE id = ?',
      [customerId],
    );
    expect(Number(after!.balance_paisa)).toBe(Number(before!.balance_paisa) - 100000);
  });

  it('does not restock damaged returned goods', async () => {
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(5) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 125000 }],
      actor: manager,
    });
    const detail = await saleDetail(db, sale.saleId);
    const line = detail.lines[0] as SaleLineRow;
    const stockBefore = Number(
      (await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [riceId]))!.stock_micro,
    );
    await createSaleReturn(db, {
      saleId: sale.saleId,
      lines: [{ saleLineId: line.id, qtyMicro: micro(2), damageQtyMicro: micro(2) }],
      reason: 'Spoiled',
      actor: manager,
    });
    const stockAfter = Number(
      (await db.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [riceId]))!.stock_micro,
    );
    expect(stockAfter).toBe(stockBefore);
  });

  it('blocks returning more than the invoice line holds', async () => {
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(3) }],
      payments: [{ methodId: 'pm_cash', amountPaisa: 75000 }],
      actor: manager,
    });
    const detail = await saleDetail(db, sale.saleId);
    const line = detail.lines[0] as SaleLineRow;
    await expect(
      createSaleReturn(db, {
        saleId: sale.saleId,
        lines: [{ saleLineId: line.id, qtyMicro: micro(4) }],
        reason: 'too many',
        actor: manager,
      }),
    ).rejects.toThrow(/Cannot return more than/i);
  });
});

describe('customer khata lifecycle', () => {
  it('reflects opening, sale, payment and return in one statement', async () => {
    const id = await createParty(db, 'customer', { nameEn: 'Ledger Test', openingBalancePaisa: 50000 }, owner);
    const sale = await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(2) }],
      customerId: id,
      payments: [],
      actor: manager,
    });
    await receiveCustomerPayment(db, {
      customerId: id,
      amountPaisa: 20000,
      methodId: 'pm_cash',
      actor: manager,
    });
    const detail = await saleDetail(db, sale.saleId);
    await createSaleReturn(db, {
      saleId: sale.saleId,
      lines: [{ saleLineId: (detail.lines[0] as SaleLineRow).id, qtyMicro: micro(1) }],
      reason: 'partial return',
      actor: manager,
    });

    const statement = await partyStatement(db, 'customer', id, dayRange());
    expect(statement.openingBalancePaisa).toBe(0);
    const balances = statement.entries.map(e => Number(e.balance_paisa));
    expect(balances[0]).toBe(50000); // opening balance
    expect(balances[1]).toBe(100000); // + 500 sale
    expect(balances[2]).toBe(80000); // - 200 payment
    expect(statement.closingBalancePaisa).toBe(55000); // - 250 return

    const customer = await db.one<{ balance_paisa: number }>(
      'SELECT balance_paisa FROM customers WHERE id = ?',
      [id],
    );
    expect(Number(customer!.balance_paisa)).toBe(55000);
  });

  it('blocks overpayment beyond the outstanding balance', async () => {
    const id = await createParty(db, 'customer', { nameEn: 'Small Khata' }, owner);
    await createSale(db, {
      lines: [{ productId: riceId, unitCode: 'kg', qtyMicro: micro(1) }],
      customerId: id,
      payments: [],
      actor: manager,
    });
    await expect(
      receiveCustomerPayment(db, { customerId: id, amountPaisa: 30000, methodId: 'pm_cash', actor: cashier }),
    ).rejects.toThrow(/exceeds outstanding/i);
  });
});
