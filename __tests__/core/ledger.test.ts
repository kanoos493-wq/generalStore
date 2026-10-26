import { QTY_SCALE } from '../../src/core/money';
import { cogsFor, profitBreakdown, stockValue, weightedAverageCost } from '../../src/core/costing';
import { allocateProportionally, buildStatement, creditLimitUsageBp, entryDelta } from '../../src/core/ledger';

const micro = (n: number) => Math.round(n * QTY_SCALE);

describe('weighted average costing', () => {
  it('averages two purchases of the same product', () => {
    const avg = weightedAverageCost({ qtyMicro: micro(100), avgCostPaisa: 10000 }, micro(100), 1200000);
    expect(avg).toBe(11000);
  });

  it('keeps the current cost when there is no stock', () => {
    expect(weightedAverageCost({ qtyMicro: 0, avgCostPaisa: 0 }, micro(10), 120000)).toBe(12000);
  });

  it('computes COGS and stock value at the average cost', () => {
    expect(cogsFor(micro(0.5), 12000)).toBe(6000);
    expect(stockValue(micro(44), 12000)).toBe(528000);
  });
});

describe('profit rules', () => {
  it('never treats purchases as the cost of goods sold', () => {
    const p = profitBreakdown({
      grossSalesPaisa: 1000000,
      discountsPaisa: 50000,
      returnsPaisa: 20000,
      cogsPaisa: 600000,
      expensesPaisa: 100000,
    });
    expect(p.netSalesPaisa).toBe(930000);
    expect(p.grossProfitPaisa).toBe(330000);
    expect(p.operatingProfitPaisa).toBe(230000);
    expect(p.grossMarginBp).toBe(3548);
  });
});

describe('ledger sign conventions', () => {
  it('treats a customer debit as money owed by the customer', () => {
    expect(entryDelta('customer', 1000, 0)).toBe(1000);
    expect(entryDelta('customer', 0, 400)).toBe(-400);
  });

  it('treats a supplier credit as money owed to the supplier', () => {
    expect(entryDelta('supplier', 0, 1000)).toBe(1000);
    expect(entryDelta('supplier', 400, 0)).toBe(-400);
  });

  it('builds a running customer statement', () => {
    const { entries, closingBalancePaisa } = buildStatement('customer', 0, [
      { at: '2026-01-01T10:00:00Z', docType: 'sale', docId: 's1', description: 'Invoice', debitPaisa: 500000 },
      { at: '2026-01-02T10:00:00Z', docType: 'payment', docId: 'p1', description: 'Cash', creditPaisa: 200000 },
      { at: '2026-01-03T10:00:00Z', docType: 'sale_return', docId: 'r1', description: 'Return', creditPaisa: 50000 },
    ]);
    expect(entries.map(e => e.balancePaisa)).toEqual([500000, 300000, 250000]);
    expect(closingBalancePaisa).toBe(250000);
  });

  it('builds a running supplier statement', () => {
    const { closingBalancePaisa } = buildStatement('supplier', 100000, [
      { at: '2026-01-01T10:00:00Z', docType: 'purchase', docId: 'p1', description: 'Purchase', creditPaisa: 400000 },
      { at: '2026-01-05T10:00:00Z', docType: 'payment', docId: 'pay1', description: 'Paid', debitPaisa: 150000 },
    ]);
    expect(closingBalancePaisa).toBe(350000);
  });

  it('allocates freight / discounts so the parts add up exactly', () => {
    const shares = allocateProportionally(101, [333, 333, 334]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(101);
  });

  it('reports credit limit usage in basis points', () => {
    expect(creditLimitUsageBp(250000, 500000)).toBe(5000);
    expect(creditLimitUsageBp(250000, 0)).toBe(0);
  });
});
