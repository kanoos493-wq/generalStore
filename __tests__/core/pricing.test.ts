import { QTY_SCALE, formatMoney, formatQty, mulDivRound, parseMoney, parseQty, roundToStep } from '../../src/core/money';
import { costPerBaseUnit, deriveUnitPrice, formatBp, grossMarginBp, lineTotal, marginPreview, markupBp, resolveUnitPrice } from '../../src/core/pricing';

const micro = (n: number) => Math.round(n * QTY_SCALE);

describe('money parsing and formatting', () => {
  it('parses rupee strings into paisa without float error', () => {
    expect(parseMoney('1200')).toBe(120000);
    expect(parseMoney('1,200.50')).toBe(120050);
    expect(parseMoney('Rs 12.5')).toBe(1250);
    expect(parseMoney('۰.۵')).toBe(50); // Urdu/Arabic-Indic digits
    expect(parseMoney(-42.42)).toBe(-4242);
  });

  it('rejects garbage instead of silently storing zero', () => {
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseQty('')).toThrow();
  });

  it('formats money with grouping', () => {
    expect(formatMoney(120050)).toBe('1,200.50');
    expect(formatMoney(-500)).toBe('-5.00');
    expect(formatMoney(120050, { grouping: false })).toBe('1200.50');
  });

  it('formats quantities trimmed to the configured precision', () => {
    expect(formatQty(micro(0.5))).toBe('0.5');
    expect(formatQty(micro(44))).toBe('44');
    expect(formatQty(micro(1.25), 6)).toBe('1.25');
    expect(formatQty(micro(0.001), 6)).toBe('0.001');
  });

  it('rounds money steps consistently', () => {
    expect(roundToStep(15049, 100)).toBe(15000);
    expect(roundToStep(15050, 100)).toBe(15100);
    expect(roundToStep(15049, 1)).toBe(15049);
  });

  it('computes exact line totals', () => {
    expect(lineTotal(15000, micro(0.5))).toBe(7500); // 150/kg * 500g = 75.00
    expect(lineTotal(2000, micro(3))).toBe(6000);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(10, 1, 3)).toBe(3);
  });
});

describe('derived pricing', () => {
  it('derives a bag price from the kg price', () => {
    expect(deriveUnitPrice(15000, micro(10))).toBe(150000); // PKR 1,500
  });

  it('derives cost per base unit from a purchase unit cost', () => {
    expect(costPerBaseUnit(120000, micro(10))).toBe(12000); // PKR 1,200/bag -> 120/kg
  });

  it('derives gram prices without rounding them to zero', () => {
    expect(deriveUnitPrice(15000, micro(0.001), 'rupee')).toBe(15);
    expect(deriveUnitPrice(15000, micro(0.001), 'paisa')).toBe(15);
  });

  it('applies rupee rounding only above one rupee', () => {
    expect(deriveUnitPrice(15033, micro(1), 'rupee')).toBe(15000);
    expect(deriveUnitPrice(15066, micro(1), 'five_rupees')).toBe(15000);
  });

  it('respects an explicit unit price override', () => {
    expect(resolveUnitPrice(15000, micro(10), 'paisa', 145000)).toBe(145000);
    expect(resolveUnitPrice(15000, micro(10), 'paisa', null)).toBe(150000);
  });

  it('computes the bag margin from the specification (20% margin, PKR 300 profit)', () => {
    const preview = marginPreview({
      unitCostPaisa: 120000,
      factorMicro: micro(10),
      baseSellPricePaisa: 15000,
    });
    expect(preview.costPerBasePaisa).toBe(12000);
    expect(preview.unitSellPricePaisa).toBe(150000);
    expect(preview.profitPerUnitPaisa).toBe(30000);
    expect(preview.marginBp).toBe(2000);
    expect(formatBp(preview.marginBp)).toBe('20.00%');
  });

  it('distinguishes margin from markup', () => {
    expect(grossMarginBp(15000, 12000)).toBe(2000);
    expect(markupBp(15000, 12000)).toBe(2500);
  });
});
