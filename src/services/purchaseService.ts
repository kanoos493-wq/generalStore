/**
 * Purchase service. A purchase document receives stock (possibly in mixed
 * units such as 4 bags + 4 kg), updates the product cost using the configured
 * valuation method, and posts the supplier payable + payments atomically.
 */
import type { Database, Tx } from '../db/database';
import type { ProductRow, PurchaseRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { BusinessError, NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { mulDivRound, QTY_SCALE } from '../core/money';
import { costPerBaseUnit, lineTotal } from '../core/pricing';
import { weightedAverageCost } from '../core/costing';
import { allocateProportionally } from '../core/ledger';
import { defaultFactorMicro } from '../core/units';
import { audit } from './auditService';
import { ensureShift, isCashMethod, postCashMovement } from './cashService';
import { postLedger } from './ledgerService';
import { loadPaymentMethod, postPayment } from './paymentService';
import { loadSettings } from './settingsService';
import { applyStockMovement } from './stockService';
import { nextDocNo } from './numbering';

export interface PurchaseLineInput {
  productId: string;
  unitCode: string;
  qtyMicro: number;
  factorMicro?: number | null;
  /** Cost of ONE entered unit (e.g. per bag), in paisa. */
  unitCostPaisa: number;
  lineDiscountPaisa?: number;
}

export interface PurchaseInput {
  lines: PurchaseLineInput[];
  supplierId?: string | null;
  refNo?: string | null;
  purchasedAt?: string;
  dueDate?: string | null;
  discountPaisa?: number;
  freightPaisa?: number;
  notes?: string | null;
  clientRef?: string | null;
  payments?: { methodId: string; amountPaisa: number; reference?: string | null }[];
  actor: Actor;
}

export interface PurchaseResult {
  purchaseId: string;
  docNo: string;
  totalPaisa: number;
  paidPaisa: number;
  payablePaisa: number;
  duplicate: boolean;
}

async function resolvePurchaseFactor(
  tx: Tx,
  product: ProductRow,
  unitCode: string,
  explicitFactor?: number | null,
): Promise<number> {
  if (explicitFactor && explicitFactor > 0) {return explicitFactor;}
  const row = await tx.one<{ factor_micro: number }>(
    `SELECT factor_micro FROM product_units WHERE product_id = ? AND unit_code = ? AND kind = 'purchase'`,
    [product.id, unitCode],
  );
  if (row) {return Number(row.factor_micro);}
  if (unitCode === product.base_unit) {return QTY_SCALE;}
  const derived = defaultFactorMicro(product.base_unit, unitCode);
  if (derived) {return derived;}
  throw new ValidationError(`Unit ${unitCode} is not configured for ${product.name_en}`, 'unit');
}

export async function createPurchase(db: Database, input: PurchaseInput): Promise<PurchaseResult> {
  assertCan(input.actor.role, 'purchase.manage');

  if (input.clientRef) {
    const existing = await db.one<PurchaseRow>('SELECT * FROM purchases WHERE client_ref = ?', [input.clientRef]);
    if (existing) {
      return {
        purchaseId: existing.id,
        docNo: existing.doc_no,
        totalPaisa: Number(existing.total_paisa),
        paidPaisa: Number(existing.paid_paisa),
        payablePaisa: Number(existing.total_paisa) - Number(existing.paid_paisa),
        duplicate: true,
      };
    }
  }

  if (!input.lines.length) {throw new ValidationError('Add at least one product', 'lines');}

  return db.tx(async tx => {
    const settings = await loadSettings(tx);
    const at = input.purchasedAt ?? nowIso();

    const prepared: {
      product: ProductRow;
      unitCode: string;
      qtyMicro: number;
      factorMicro: number;
      baseQtyMicro: number;
      unitCostPaisa: number;
      lineDiscountPaisa: number;
      netPaisa: number;
      oldStockMicro: number;
      oldCostPaisa: number;
    }[] = [];

    let subtotal = 0;
    for (const line of input.lines) {
      const product = await tx.one<ProductRow>('SELECT * FROM products WHERE id = ?', [line.productId]);
      if (!product) {throw new NotFoundError('Product', line.productId);}
      const qty = Math.round(line.qtyMicro);
      if (qty <= 0) {throw new ValidationError('Quantity must be greater than zero', 'qty');}
      const unitCost = Math.round(line.unitCostPaisa ?? 0);
      if (unitCost < 0) {throw new ValidationError('Cost cannot be negative', 'cost');}
      const factor = await resolvePurchaseFactor(tx, product, line.unitCode, line.factorMicro);
      const baseQty = mulDivRound(qty, factor, QTY_SCALE);
      if (baseQty <= 0) {throw new ValidationError('Quantity is too small to record', 'qty');}
      const gross = lineTotal(unitCost, qty);
      const lineDiscount = Math.round(line.lineDiscountPaisa ?? 0);
      if (lineDiscount < 0 || lineDiscount > gross) {
        throw new ValidationError('Invalid line discount', 'discount');
      }
      const net = gross - lineDiscount;
      subtotal += gross;
      prepared.push({
        product,
        unitCode: line.unitCode,
        qtyMicro: qty,
        factorMicro: factor,
        baseQtyMicro: baseQty,
        unitCostPaisa: unitCost,
        lineDiscountPaisa: lineDiscount,
        netPaisa: net,
        oldStockMicro: Number(product.stock_micro),
        oldCostPaisa: Number(product.cost_paisa),
      });
    }

    const fixedDiscount = Math.round(input.discountPaisa ?? 0);
    const freight = Math.round(input.freightPaisa ?? 0);
    if (fixedDiscount < 0 || freight < 0) {
      throw new ValidationError('Discount and freight cannot be negative');
    }
    const total = subtotal - fixedDiscount + freight;
    if (total < 0) {throw new ValidationError('Purchase total cannot be negative');}

    // freight increases the cost basis, allocated by line value
    const freightShares = allocateProportionally(freight, prepared.map(p => p.netPaisa));

    const docNo = await nextDocNo(tx, {
      scope: 'purchase',
      prefix: settings.purchasePrefix,
      date: new Date(at),
    });
    const purchaseId = newId('pur');

    let supplierName: string | null = null;
    if (input.supplierId) {
      const supplier = await tx.one<{ name_en: string }>('SELECT name_en FROM suppliers WHERE id = ?', [
        input.supplierId,
      ]);
      if (!supplier) {throw new NotFoundError('Supplier', input.supplierId);}
      supplierName = supplier.name_en;
    }

    const tenderInputs = input.payments ?? [];
    let appliedTotal = 0;
    const applied: { methodId: string; amountPaisa: number; reference?: string | null }[] = [];
    for (const p of tenderInputs) {
      const amount = Math.round(p.amountPaisa);
      if (amount <= 0) {continue;}
      const method = await loadPaymentMethod(tx, p.methodId);
      if (method.is_credit) {continue;}
      const remaining = total - appliedTotal;
      if (remaining <= 0) {break;}
      const appliedAmount = Math.min(amount, remaining);
      applied.push({ methodId: p.methodId, amountPaisa: appliedAmount, reference: p.reference ?? null });
      appliedTotal += appliedAmount;
    }
    const payable = total - appliedTotal;
    if (payable > 0 && !input.supplierId) {
      // A credit purchase must belong to a supplier, otherwise the debt is untracked.
      throw new BusinessError('Select a supplier to record an unpaid purchase', 'supplier_required');
    }

    await tx.exec(
      `INSERT INTO purchases (id, doc_no, supplier_id, supplier_name, ref_no, purchased_at, due_date,
          subtotal_paisa, discount_paisa, freight_paisa, tax_paisa, total_paisa, paid_paisa, status, notes,
          client_ref, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'posted', ?, ?, ?, ?)`,
      [
        purchaseId,
        docNo,
        input.supplierId ?? null,
        supplierName,
        input.refNo ?? null,
        at,
        input.dueDate ?? null,
        subtotal,
        fixedDiscount,
        freight,
        total,
        appliedTotal,
        input.notes ?? null,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );

    for (let i = 0; i < prepared.length; i += 1) {
      const line = prepared[i];
      const costBasis = line.netPaisa + freightShares[i];
      const perBase = costPerBaseUnit(line.unitCostPaisa, line.factorMicro);
      await tx.exec(
        `INSERT INTO purchase_lines (id, purchase_id, product_id, product_name, unit_code, qty_micro,
            factor_micro, base_qty_micro, unit_cost_paisa, line_discount_paisa, line_total_paisa, cost_per_base_paisa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('pln'),
          purchaseId,
          line.product.id,
          line.product.name_en,
          line.unitCode,
          line.qtyMicro,
          line.factorMicro,
          line.baseQtyMicro,
          line.unitCostPaisa,
          line.lineDiscountPaisa,
          line.netPaisa,
          perBase,
        ],
      );

      await applyStockMovement(tx, {
        productId: line.product.id,
        deltaMicro: line.baseQtyMicro,
        type: 'purchase',
        unitCode: line.unitCode,
        enteredQtyMicro: line.qtyMicro,
        factorMicro: line.factorMicro,
        unitCostPaisa: perBase,
        docType: 'purchase',
        docId: purchaseId,
        docNo,
        reason: 'Purchase',
        actorName: input.actor.name,
        at,
        allowNegative: settings.allowNegativeStock,
      });

      const newCost =
        settings.valuationMethod === 'latest'
          ? perBase
          : weightedAverageCost(
              { qtyMicro: line.oldStockMicro, avgCostPaisa: line.oldCostPaisa },
              line.baseQtyMicro,
              costBasis,
            );
      await tx.exec('UPDATE products SET cost_paisa = ?, updated_at = ? WHERE id = ?', [
        Math.max(0, Math.round(newCost)),
        at,
        line.product.id,
      ]);
    }

    const shift = applied.some(p => p.amountPaisa > 0) ? await ensureShift(tx, input.actor) : null;
    for (const p of applied) {
      await postPayment(tx, {
        partyType: 'supplier',
        partyId: input.supplierId ?? null,
        partyName: supplierName,
        amountPaisa: p.amountPaisa,
        methodId: p.methodId,
        direction: 'out',
        docType: 'purchase',
        docId: purchaseId,
        paidAt: at,
        reference: p.reference ?? null,
        actor: input.actor,
        skipLedger: true,
        skipCash: true,
      });
      const cash = await isCashMethod(tx, p.methodId);
      if (cash && shift) {
        await postCashMovement(tx, {
          shiftId: shift.id,
          direction: 'out',
          amountPaisa: p.amountPaisa,
          sourceType: 'purchase',
          sourceId: purchaseId,
          description: `Cash purchase ${docNo}`,
          actor: input.actor,
          at,
        });
      }
    }

    if (input.supplierId) {
      await postLedger(tx, {
        partyType: 'supplier',
        partyId: input.supplierId,
        at,
        docType: 'purchase',
        docId: purchaseId,
        description: `Purchase ${docNo}`,
        creditPaisa: total,
        actorName: input.actor.name,
      });
      for (const p of applied) {
        await postLedger(tx, {
          partyType: 'supplier',
          partyId: input.supplierId,
          at,
          docType: 'payment',
          docId: purchaseId,
          description: `Payment - ${docNo}`,
          debitPaisa: p.amountPaisa,
          actorName: input.actor.name,
        });
      }
    }

    await audit(tx, {
      actor: input.actor,
      action: 'purchase.create',
      entity: 'purchase',
      entityId: purchaseId,
      details: { docNo, total, paid: appliedTotal, payable, lines: prepared.length },
    });

    return { purchaseId, docNo, totalPaisa: total, paidPaisa: appliedTotal, payablePaisa: payable, duplicate: false };
  });
}

/** Audit-safe reversal of a purchase (stock out, payable cleared). */
export async function voidPurchase(
  db: Database,
  input: { purchaseId: string; reason: string; actor: Actor },
): Promise<void> {
  assertCan(input.actor.role, 'settings.manage');
  await db.tx(async tx => {
    const purchase = await tx.one<PurchaseRow>('SELECT * FROM purchases WHERE id = ?', [input.purchaseId]);
    if (!purchase) {throw new NotFoundError('Purchase', input.purchaseId);}
    if (purchase.status !== 'posted') {throw new BusinessError('Purchase is already reversed');}
    const lines = await tx.query('SELECT * FROM purchase_lines WHERE purchase_id = ?', [purchase.id]);
    const at = nowIso();
    for (const line of lines) {
      await applyStockMovement(tx, {
        productId: String(line.product_id),
        deltaMicro: -Number(line.base_qty_micro),
        type: 'purchase_return',
        unitCode: String(line.unit_code),
        enteredQtyMicro: Number(line.qty_micro),
        factorMicro: Number(line.factor_micro),
        unitCostPaisa: Number(line.unit_cost_paisa),
        docType: 'purchase_void',
        docId: purchase.id,
        docNo: purchase.doc_no,
        reason: `Void: ${input.reason}`,
        actorName: input.actor.name,
        at,
        allowNegative: false,
      });
    }
    if (purchase.supplier_id) {
      await postLedger(tx, {
        partyType: 'supplier',
        partyId: purchase.supplier_id,
        at,
        docType: 'purchase_void',
        docId: purchase.id,
        description: `Reversed purchase ${purchase.doc_no}: ${input.reason}`,
        debitPaisa: Number(purchase.total_paisa),
        actorName: input.actor.name,
      });
    }
    await tx.exec(`UPDATE purchases SET status = 'reversed', reversed_at = ?, reversed_by = ?, reversal_reason = ? WHERE id = ?`, [
      at,
      input.actor.name,
      input.reason,
      purchase.id,
    ]);
    await audit(tx, {
      actor: input.actor,
      action: 'purchase.void',
      entity: 'purchase',
      entityId: purchase.id,
      details: { reason: input.reason, docNo: purchase.doc_no },
    });
  });
}

export interface PurchaseListFilters {
  from?: string;
  to?: string;
  supplierId?: string;
  status?: string;
  query?: string;
  limit?: number;
  beforePurchasedAt?: string;
  beforeId?: string;
}

export async function listPurchases(db: Database, filters: PurchaseListFilters = {}) {
  const limit = Math.min(filters.limit ?? 40, 200);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.from) {where.push('p.purchased_at >= ?'); params.push(filters.from);}
  if (filters.to) {where.push('p.purchased_at <= ?'); params.push(filters.to);}
  if (filters.status) {where.push('p.status = ?'); params.push(filters.status);}
  if (filters.supplierId) {where.push('p.supplier_id = ?'); params.push(filters.supplierId);}
  if (filters.query) {
    where.push(`(p.doc_no LIKE ? ESCAPE '\\' OR p.supplier_name LIKE ? ESCAPE '\\')`);
    params.push(`%${filters.query}%`, `%${filters.query}%`);
  }
  if (filters.beforePurchasedAt) {
    where.push('(p.purchased_at < ? OR (p.purchased_at = ? AND p.id < ?))');
    params.push(filters.beforePurchasedAt, filters.beforePurchasedAt, filters.beforeId ?? '');
  }
  params.push(limit);
  const rows = await db.query(
    `SELECT p.*, (SELECT COUNT(*) FROM purchase_lines l WHERE l.purchase_id = p.id) AS line_count
     FROM purchases p
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.purchased_at DESC, p.id DESC LIMIT ?`,
    params,
  );
  return rows as unknown as (PurchaseRow & { line_count: number })[];
}

export async function purchaseDetail(db: Database, purchaseId: string) {
  const purchase = await db.one<PurchaseRow>('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
  if (!purchase) {throw new NotFoundError('Purchase', purchaseId);}
  const lines = await db.query('SELECT * FROM purchase_lines WHERE purchase_id = ? ORDER BY rowid', [purchaseId]);
  const payments = await db.query('SELECT * FROM payments WHERE doc_type = ? AND doc_id = ?', [
    'purchase',
    purchaseId,
  ]);
  return { purchase, lines, payments };
}
