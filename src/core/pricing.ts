/** Pricing rules: derived unit prices, rounding, margin vs markup. */
import { mulDivRound, QTY_SCALE, ratioBp, roundToStep } from './money';

export type PriceRounding = 'paisa' | 'rupee' | 'five_rupees';

export const PRICE_ROUNDING_STEPS: Record<PriceRounding, number> = {
  paisa: 1,
  rupee: 100,
  five_rupees: 500,
};

/**
 * Derive the selling price of a packaged unit from the base unit price.
 * base 15000 paisa/kg, factor 10 (bag) => 150000 paisa (PKR 1,500).
 */
export function deriveUnitPrice(
  basePricePaisa: number,
  factorMicro: number,
  rounding: PriceRounding = 'paisa',
): number {
  const raw = mulDivRound(basePricePaisa, factorMicro, QTY_SCALE);
  if (raw <= 0) {return 0;}
  const step = PRICE_ROUNDING_STEPS[rounding];
  // Never round a sub-step price down to zero (0.15 PKR per gram must stay 15 paisa).
  if (step > 1 && raw < step) {return Math.max(1, raw);}
  return roundToStep(raw, step);
}

/** Price used for a line: explicit override wins, otherwise derived. */
export function resolveUnitPrice(
  basePricePaisa: number,
  factorMicro: number,
  rounding: PriceRounding,
  overridePaisa?: number | null,
): number {
  if (overridePaisa !== undefined && overridePaisa !== null && overridePaisa >= 0) {
    return Math.round(overridePaisa);
  }
  return deriveUnitPrice(basePricePaisa, factorMicro, rounding);
}

/** Line total in paisa = unit price * quantity (exact, half-up). */
export function lineTotal(unitPricePaisa: number, qtyMicro: number): number {
  return mulDivRound(unitPricePaisa, qtyMicro, QTY_SCALE);
}

/** Effective cost of one base unit for a purchase at `unitCostPaisa` per `unit`. */
export function costPerBaseUnit(unitCostPaisa: number, factorMicro: number): number {
  if (!factorMicro) {return unitCostPaisa;}
  return mulDivRound(unitCostPaisa, QTY_SCALE, factorMicro);
}

/** Gross margin in basis points: (price - cost) / price. */
export function grossMarginBp(pricePaisa: number, costPaisa: number): number {
  if (!pricePaisa) {return 0;}
  return ratioBp(pricePaisa - costPaisa, pricePaisa);
}

/** Markup in basis points: (price - cost) / cost. */
export function markupBp(pricePaisa: number, costPaisa: number): number {
  if (!costPaisa) {return 0;}
  return ratioBp(pricePaisa - costPaisa, costPaisa);
}

export function formatBp(bp: number, decimals = 2): string {
  return `${(bp / 100).toFixed(decimals)}%`;
}

/** Price preview shown on purchase entry and product form. */
export interface MarginPreview {
  costPerBasePaisa: number;
  baseSellPricePaisa: number;
  unitSellPricePaisa: number;
  profitPerUnitPaisa: number;
  marginBp: number;
  markupBp: number;
}

export function marginPreview(input: {
  unitCostPaisa: number;
  factorMicro: number;
  baseSellPricePaisa: number;
  rounding?: PriceRounding;
  unitPriceOverridePaisa?: number | null;
}): MarginPreview {
  const costPerBasePaisa = costPerBaseUnit(input.unitCostPaisa, input.factorMicro);
  const unitSellPricePaisa = resolveUnitPrice(
    input.baseSellPricePaisa,
    input.factorMicro,
    input.rounding ?? 'paisa',
    input.unitPriceOverridePaisa,
  );
  return {
    costPerBasePaisa,
    baseSellPricePaisa: input.baseSellPricePaisa,
    unitSellPricePaisa,
    profitPerUnitPaisa: unitSellPricePaisa - input.unitCostPaisa,
    marginBp: grossMarginBp(unitSellPricePaisa, input.unitCostPaisa),
    markupBp: markupBp(unitSellPricePaisa, input.unitCostPaisa),
  };
}
