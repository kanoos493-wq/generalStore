/**
 * Costing & profit rules.
 *
 * Default valuation method: weighted average cost (WAC) per base unit.
 * Historical sale lines keep the cost that was current when the sale was made
 * (`unit_cost_paisa`, `cogs_paisa`) so later price changes never rewrite
 * history.
 */
import { divRound, mulDivRound, QTY_SCALE } from './money';

export type CostingMethod = 'wac' | 'latest';

export interface CostState {
  qtyMicro: number;
  avgCostPaisa: number;
}

/**
 * New weighted average cost after receiving `addQtyMicro` at total cost
 * `addTotalPaisa`. Returns the previous average when quantity is zero.
 */
export function weightedAverageCost(
  current: CostState,
  addQtyMicro: number,
  addTotalPaisa: number,
): number {
  const newQty = current.qtyMicro + addQtyMicro;
  if (newQty <= 0) {return current.avgCostPaisa;}
  const currentValue = mulDivRound(current.avgCostPaisa, Math.max(current.qtyMicro, 0), QTY_SCALE);
  const totalValue = BigInt(Math.round(currentValue)) + BigInt(Math.round(addTotalPaisa));
  const result = divRound(totalValue * BigInt(QTY_SCALE), BigInt(Math.round(newQty)));
  const value = Number(result);
  if (!Number.isSafeInteger(value)) {throw new Error('Cost overflow');}
  return Math.max(0, value);
}

/** Cost of goods sold for a quantity at a given average cost per base unit. */
export function cogsFor(qtyMicro: number, avgCostPaisa: number): number {
  return mulDivRound(qtyMicro, avgCostPaisa, QTY_SCALE);
}

/** Stock value at WAC. */
export function stockValue(qtyMicro: number, avgCostPaisa: number): number {
  return cogsFor(qtyMicro, avgCostPaisa);
}

export interface ProfitBreakdown {
  netSalesPaisa: number;
  cogsPaisa: number;
  grossProfitPaisa: number;
  expensesPaisa: number;
  operatingProfitPaisa: number;
  grossMarginBp: number;
}

/**
 * Gross profit = net sales - COGS.
 * Operating profit = gross profit - recorded operating expenses.
 * It deliberately excludes owner drawings, loan interest, depreciation and
 * capital purchases; this is documented in ACCOUNTING_RULES.md.
 */
export function profitBreakdown(input: {
  grossSalesPaisa: number;
  discountsPaisa: number;
  returnsPaisa: number;
  cogsPaisa: number;
  expensesPaisa: number;
}): ProfitBreakdown {
  const netSales = input.grossSalesPaisa - input.discountsPaisa - input.returnsPaisa;
  const grossProfit = netSales - input.cogsPaisa;
  return {
    netSalesPaisa: netSales,
    cogsPaisa: input.cogsPaisa,
    grossProfitPaisa: grossProfit,
    expensesPaisa: input.expensesPaisa,
    operatingProfitPaisa: grossProfit - input.expensesPaisa,
    grossMarginBp: netSales ? Math.round(((grossProfit * 10000) / netSales)) : 0,
  };
}
