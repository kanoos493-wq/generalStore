/**
 * Stock adjustments and physical counts.
 *
 * Types: opening | count | damage | wastage | found | correction.
 * A supplier receipt that creates a payable MUST be a purchase — this service
 * refuses to create supplier debt, so stock and payables can never diverge.
 */
import type { Database } from '../db/database';
import type { ProductRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { BusinessError, NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { mulDivRound, QTY_SCALE } from '../core/money';
import { weightedAverageCost } from '../core/costing';
import { defaultFactorMicro } from '../core/units';
import { audit } from './auditService';
import { loadSettings } from './settingsService';
import { applyStockMovement } from './stockService';
import { nextDocNo } from './numbering';

export type AdjustmentType = 'opening' | 'count' | 'damage' | 'wastage' | 'found' | 'correction';

export const ADJUSTMENT_TYPES: { type: AdjustmentType; en: string; ur: string }[] = [
  { type: 'opening', en: 'Opening stock', ur: 'ابتدائی اسٹاک' },
  { type: 'count', en: 'Stock count correction', ur: 'اسٹاک گنتی درستگی' },
  { type: 'damage', en: 'Damaged stock', ur: 'خراب اسٹاک' },
  { type: 'wastage', en: 'Wastage', ur: 'ضیاع' },
  { type: 'found', en: 'Found stock', ur: 'اضافی اسٹاک' },
  { type: 'correction', en: 'Internal correction', ur: 'اندرونی درستگی' },
];

export interface AdjustmentLineInput {
  productId: string;
  /** Unit used to enter the quantity (defaults to the product base unit). */
  unitCode?: string;
  /** Signed or unsigned quantity depending on the adjustment type. */
  qtyMicro?: number;
  /** Counted quantity in the base unit, for `count`. */
  countedQtyMicro?: number;
  unitCostPaisa?: number;
  notes?: string | null;
}

export interface AdjustmentInput {
  type: AdjustmentType;
  reason: string;
  notes?: string | null;
  adjustedAt?: string;
  lines: AdjustmentLineInput[];
  actor: Actor;
  clientRef?: string | null;
}

export interface AdjustmentResult {
  id: string;
  docNo: string;
  deltaMicro: number;
  lines: number;
}

export async function createAdjustment(db: Database, input: AdjustmentInput): Promise<AdjustmentResult> {
  assertCan(input.actor.role, 'stock.adjust');
  if (!input.reason.trim()) {throw new ValidationError('A reason is required for stock adjustments', 'reason');}
  if (!input.lines.length) {throw new ValidationError('Add at least one product', 'lines');}

  return db.tx(async tx => {
    const settings = await loadSettings(tx);
    const at = input.adjustedAt ?? nowIso();
    const docNo = await nextDocNo(tx, {
      scope: 'adjustment',
      prefix: settings.adjustmentPrefix,
      date: new Date(at),
    });
    const id = newId('adj');

    const prepared: {
      product: ProductRow;
      unitCode: string;
      qtyMicro: number;
      factorMicro: number;
      deltaMicro: number;
      systemMicro: number | null;
      countedMicro: number | null;
      unitCostPaisa: number;
    }[] = [];

    for (const line of input.lines) {
      const product = await tx.one<ProductRow>('SELECT * FROM products WHERE id = ?', [line.productId]);
      if (!product) {throw new NotFoundError('Product', line.productId);}
      const unitCode = line.unitCode ?? product.base_unit;
      let factor = QTY_SCALE;
      if (unitCode !== product.base_unit) {
        const row = await tx.one<{ factor_micro: number }>(
          `SELECT factor_micro FROM product_units WHERE product_id = ? AND unit_code = ? AND kind = 'purchase'`,
          [product.id, unitCode],
        );
        factor = row ? Number(row.factor_micro) : defaultFactorMicro(product.base_unit, unitCode) ?? QTY_SCALE;
      }

      let delta = 0;
      let systemMicro: number | null = null;
      let countedMicro: number | null = null;
      const qty = Math.round(line.qtyMicro ?? 0);

      switch (input.type) {
        case 'count': {
          countedMicro = Math.round(line.countedQtyMicro ?? 0);
          if (countedMicro < 0) {throw new ValidationError('Counted quantity cannot be negative', 'qty');}
          systemMicro = Number(product.stock_micro);
          delta = countedMicro - systemMicro;
          break;
        }
        case 'opening':
        case 'found': {
          if (qty <= 0) {throw new ValidationError('Quantity must be greater than zero', 'qty');}
          delta = mulDivRound(qty, factor, QTY_SCALE);
          break;
        }
        case 'damage':
        case 'wastage': {
          if (qty <= 0) {throw new ValidationError('Quantity must be greater than zero', 'qty');}
          delta = -mulDivRound(qty, factor, QTY_SCALE);
          break;
        }
        case 'correction': {
          if (qty === 0) {throw new ValidationError('Quantity cannot be zero', 'qty');}
          delta = mulDivRound(qty, factor, QTY_SCALE);
          break;
        }
        default:
          throw new BusinessError(`Unsupported adjustment type ${input.type}`, 'type');
      }

      if (delta === 0) {
        if (input.type === 'count') {continue;} // counted exactly what the system says
        throw new ValidationError('Adjustment quantity cannot be zero', 'qty');
      }

      prepared.push({
        product,
        unitCode,
        qtyMicro: qty === 0 ? Math.abs(delta) : qty,
        factorMicro: factor,
        deltaMicro: delta,
        systemMicro,
        countedMicro,
        unitCostPaisa: Math.round(line.unitCostPaisa ?? product.cost_paisa),
      });
    }

    if (!prepared.length) {
      throw new ValidationError('Nothing to adjust: counted quantities match the system', 'lines');
    }

    const totalCost = prepared.reduce(
      (sum, p) => sum + (p.deltaMicro > 0 ? mulDivRound(p.deltaMicro, p.unitCostPaisa, QTY_SCALE) : 0),
      0,
    );

    await tx.exec(
      `INSERT INTO adjustments (id, doc_no, adjusted_at, type, reason, notes, total_cost_paisa, status,
          client_ref, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
      [
        id,
        docNo,
        at,
        input.type,
        input.reason.trim(),
        input.notes ?? null,
        totalCost,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );

    let deltaSum = 0;
    for (const p of prepared) {
      await tx.exec(
        `INSERT INTO adjustment_lines (id, adjustment_id, product_id, product_name, unit_code, qty_micro,
            factor_micro, base_qty_micro, unit_cost_paisa, system_qty_micro, counted_qty_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('adjl'),
          id,
          p.product.id,
          p.product.name_en,
          p.unitCode,
          p.qtyMicro,
          p.factorMicro,
          p.deltaMicro,
          p.unitCostPaisa,
          p.systemMicro,
          p.countedMicro,
        ],
      );

      const movementType =
        input.type === 'count'
          ? 'count'
          : input.type === 'damage'
            ? 'damage'
            : input.type === 'wastage'
              ? 'wastage'
              : input.type === 'found'
                ? 'found'
                : input.type === 'opening'
                  ? 'opening'
                  : 'adjustment';

      await applyStockMovement(tx, {
        productId: p.product.id,
        deltaMicro: p.deltaMicro,
        type: movementType,
        unitCode: p.unitCode,
        enteredQtyMicro: p.qtyMicro,
        factorMicro: p.factorMicro,
        unitCostPaisa: p.unitCostPaisa,
        docType: 'adjustment',
        docId: id,
        docNo,
        reason: input.reason,
        notes: input.notes ?? null,
        actorName: input.actor.name,
        at,
        allowNegative: settings.allowNegativeStock,
      });

      if (p.deltaMicro > 0 && p.unitCostPaisa > 0 && (input.type === 'opening' || input.type === 'found')) {
        const newCost =
          input.type === 'opening' && Number(p.product.cost_paisa) === 0
            ? p.unitCostPaisa
            : weightedAverageCost(
                { qtyMicro: Number(p.product.stock_micro), avgCostPaisa: Number(p.product.cost_paisa) },
                p.deltaMicro,
                mulDivRound(p.deltaMicro, p.unitCostPaisa, QTY_SCALE),
              );
        await tx.exec('UPDATE products SET cost_paisa = ?, updated_at = ? WHERE id = ?', [
          Math.max(0, Math.round(newCost)),
          at,
          p.product.id,
        ]);
      }
      deltaSum += p.deltaMicro;
    }

    await audit(tx, {
      actor: input.actor,
      action: 'stock.adjust',
      entity: 'adjustment',
      entityId: id,
      details: { docNo, type: input.type, reason: input.reason, lines: prepared.length },
    });

    return { id, docNo, deltaMicro: deltaSum, lines: prepared.length };
  });
}

export async function listAdjustments(db: Database, limit = 40) {
  return db.query(
    `SELECT a.*, (SELECT COUNT(*) FROM adjustment_lines l WHERE l.adjustment_id = a.id) AS line_count
     FROM adjustments a ORDER BY a.adjusted_at DESC LIMIT ?`,
    [limit],
  );
}

export async function adjustmentDetail(db: Database, id: string) {
  const header = await db.one('SELECT * FROM adjustments WHERE id = ?', [id]);
  if (!header) {throw new NotFoundError('Adjustment', id);}
  const lines = await db.query('SELECT * FROM adjustment_lines WHERE adjustment_id = ? ORDER BY rowid', [id]);
  return { header, lines };
}

/** Physical count sheet: system vs counted quantities for a filtered product set. */
export async function countSheet(db: Database, query?: string) {
  const params: (string | number)[] = [];
  let sql = `SELECT id, code, name_en, name_ur, base_unit, stock_micro, cost_paisa
             FROM products WHERE archived_at IS NULL AND is_active = 1`;
  if (query && query.trim()) {
    sql += ` AND search_blob LIKE ? ESCAPE '\\'`;
    params.push(`%${query.toLowerCase()}%`);
  }
  sql += ' ORDER BY name_en LIMIT 200';
  return db.query(sql, params);
}

export async function lowStockProducts(db: Database, limit = 100) {
  return db.query(
    `SELECT * FROM products WHERE archived_at IS NULL AND is_active = 1 AND stock_micro <= min_stock_micro
     ORDER BY (stock_micro <= 0) DESC, name_en LIMIT ?`,
    [limit],
  );
}

export async function restockSuggestions(db: Database, limit = 100) {
  const rows = await db.query(
    `SELECT p.*, s.name_en AS supplier_name,
       (SELECT COALESCE(SUM(l.base_qty_micro),0) FROM sale_lines l JOIN sales sa ON sa.id = l.sale_id
         WHERE l.product_id = p.id AND sa.status = 'posted'
           AND sa.sold_at >= datetime('now','-30 days')) AS sold_30d_micro
     FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.archived_at IS NULL AND p.is_active = 1 AND p.stock_micro <= p.min_stock_micro
     ORDER BY (p.stock_micro <= 0) DESC, p.name_en LIMIT ?`,
    [limit],
  );
  return rows;
}
