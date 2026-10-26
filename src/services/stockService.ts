/**
 * Central stock engine. EVERY stock change in the application goes through
 * `applyStockMovement`, which:
 *  - validates the negative-stock policy
 *  - updates the cached `products.stock_micro`
 *  - appends an immutable `stock_movements` audit row with the running balance
 */
import type { Tx } from '../db/database';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { InsufficientStockError, NotFoundError, ValidationError } from '../core/errors';
import type { ProductRow } from '../db/types';

export type StockMovementType =
  | 'opening'
  | 'sale'
  | 'sale_return'
  | 'purchase'
  | 'purchase_return'
  | 'adjustment'
  | 'damage'
  | 'count'
  | 'wastage'
  | 'found';

export interface StockChange {
  productId: string;
  /** Signed change in micro base units (+receive / -issue). */
  deltaMicro: number;
  type: StockMovementType;
  /** Unit the operator actually entered, for the audit trail. */
  unitCode: string;
  enteredQtyMicro: number;
  factorMicro: number;
  unitCostPaisa?: number;
  docType: string;
  docId?: string | null;
  docNo?: string | null;
  reason?: string | null;
  notes?: string | null;
  actorName?: string | null;
  at?: string;
  reversalOf?: string | null;
  allowNegative?: boolean;
}

export interface StockChangeResult {
  movementId: string;
  balanceAfterMicro: number;
}

export async function applyStockMovement(tx: Tx, change: StockChange): Promise<StockChangeResult> {
  const product = await tx.one<ProductRow>('SELECT * FROM products WHERE id = ?', [change.productId]);
  if (!product) {throw new NotFoundError('Product', change.productId);}

  const current = Number(product.stock_micro);
  const delta = Math.round(change.deltaMicro);
  if (delta === 0) {
    throw new ValidationError('Stock change quantity cannot be zero');
  }
  const balanceAfter = current + delta;
  if (balanceAfter < 0 && !change.allowNegative) {
    throw new InsufficientStockError(product.name_en, current, Math.abs(delta));
  }

  const at = change.at ?? nowIso();
  const movementId = newId('mov');
  await tx.exec('UPDATE products SET stock_micro = ?, updated_at = ? WHERE id = ?', [
    balanceAfter,
    at,
    product.id,
  ]);
  await tx.exec(
    `INSERT INTO stock_movements (
       id, product_id, moved_at, type, qty_micro, unit_code, entered_qty_micro, factor_micro,
       unit_cost_paisa, balance_after_micro, doc_type, doc_id, doc_no, reason, notes,
       created_by, reversal_of, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movementId,
      product.id,
      at,
      change.type,
      delta,
      change.unitCode,
      Math.round(change.enteredQtyMicro),
      Math.round(change.factorMicro),
      Math.round(change.unitCostPaisa ?? 0),
      balanceAfter,
      change.docType,
      change.docId ?? null,
      change.docNo ?? null,
      change.reason ?? null,
      change.notes ?? null,
      change.actorName ?? null,
      change.reversalOf ?? null,
      at,
    ],
  );
  return { movementId, balanceAfterMicro: balanceAfter };
}

/** Update the product's weighted-average / latest cost after a receipt. */
export async function setProductCost(
  tx: Tx,
  productId: string,
  newCostPaisa: number,
  method: 'wac' | 'latest',
  at: string = nowIso(),
): Promise<void> {
  const cost = Math.max(0, Math.round(newCostPaisa));
  await tx.exec('UPDATE products SET cost_paisa = ?, updated_at = ? WHERE id = ?', [cost, at, productId]);
}

export async function productStockMicro(tx: Tx, productId: string): Promise<number> {
  const row = await tx.one<{ stock_micro: number }>('SELECT stock_micro FROM products WHERE id = ?', [
    productId,
  ]);
  return Number(row?.stock_micro ?? 0);
}
