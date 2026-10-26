/**
 * Returns and exchanges. A return never edits the original document: it creates
 * a linked return document, restores stock, reverses COGS and adjusts the
 * party ledger or pays a refund.
 */
import type { Database } from '../db/database';
import type { PurchaseRow, SaleLineRow, SaleRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { BusinessError, NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { mulDivRound, QTY_SCALE } from '../core/money';
import { audit } from './auditService';
import { ensureShift, isCashMethod, postCashMovement } from './cashService';
import { postLedger } from './ledgerService';
import { loadPaymentMethod, postPayment } from './paymentService';
import { loadSettings } from './settingsService';
import { applyStockMovement } from './stockService';
import { nextDocNo } from './numbering';

export interface SaleReturnLineInput {
  saleLineId: string;
  qtyMicro: number;
  /** Portion of the returned quantity that cannot be resold. */
  damageQtyMicro?: number;
}

export interface SaleReturnInput {
  saleId: string;
  lines: SaleReturnLineInput[];
  /** When omitted, the customer receives a credit note on their khata. */
  refundMethodId?: string | null;
  restock?: boolean;
  reason: string;
  notes?: string | null;
  clientRef?: string | null;
  returnedAt?: string;
  actor: Actor;
}

export interface ReturnResult {
  returnId: string;
  docNo: string;
  totalPaisa: number;
  refundedPaisa: number;
  creditNotePaisa: number;
}

export async function createSaleReturn(db: Database, input: SaleReturnInput): Promise<ReturnResult> {
  assertCan(input.actor.role, 'sale.return');
  if (!input.reason.trim()) {throw new ValidationError('A reason is required for returns', 'reason');}
  return db.tx(async tx => {
    const sale = await tx.one<SaleRow>('SELECT * FROM sales WHERE id = ?', [input.saleId]);
    if (!sale) {throw new NotFoundError('Sale', input.saleId);}
    if (sale.status !== 'posted') {throw new BusinessError('Only posted sales can be returned');}
    const settings = await loadSettings(tx);
    const at = input.returnedAt ?? nowIso();
    const restock = input.restock !== false;

    let total = 0;
    let totalCogs = 0;
    const prepared: { line: SaleLineRow; qtyMicro: number; baseQtyMicro: number; creditPaisa: number; damageMicro: number }[] = [];

    for (const item of input.lines) {
      const line = await tx.one<SaleLineRow>('SELECT * FROM sale_lines WHERE id = ? AND sale_id = ?', [
        item.saleLineId,
        sale.id,
      ]);
      if (!line) {throw new NotFoundError('Sale line', item.saleLineId);}
      const qty = Math.round(item.qtyMicro);
      if (qty <= 0) {continue;}
      const available = Number(line.qty_micro) - Number(line.returned_qty_micro);
      if (qty > available) {
        throw new ValidationError(`Cannot return more than ${available / QTY_SCALE} of ${line.product_name}`, 'qty');
      }
      const damage = Math.min(Math.round(item.damageQtyMicro ?? 0), qty);
      const baseQty = mulDivRound(qty, Number(line.factor_micro), QTY_SCALE);
      const credit = mulDivRound(Number(line.line_total_paisa), qty, Number(line.qty_micro));
      const cogs = mulDivRound(Number(line.cogs_paisa), qty, Number(line.qty_micro));
      total += credit;
      totalCogs += cogs;
      prepared.push({ line, qtyMicro: qty, baseQtyMicro: baseQty, creditPaisa: credit, damageMicro: damage });
    }

    if (!prepared.length) {throw new ValidationError('Select at least one line to return', 'lines');}

    // how much cash can actually be refunded (money the customer really paid)
    const paidSoFar = Number(sale.paid_paisa);
    const refundedSoFar = await tx.one<{ total: number }>(
      `SELECT COALESCE(SUM(refunded_paisa),0) AS total FROM returns WHERE original_id = ? AND status = 'posted'`,
      [sale.id],
    );
    const refundableCash = paidSoFar - Number(refundedSoFar?.total ?? 0);
    if (input.refundMethodId && total > refundableCash) {
      throw new ValidationError(
        'Refund exceeds the amount the customer actually paid; use a credit note instead',
        'refund',
      );
    }

    const docNo = await nextDocNo(tx, { scope: 'sale_return', prefix: `${settings.returnPrefix}-SR`, date: new Date(at) });
    const returnId = newId('ret');
    await tx.exec(
      `INSERT INTO returns (id, doc_no, type, original_id, original_no, party_type, party_id, party_name,
          returned_at, subtotal_paisa, total_paisa, refund_method_id, refunded_paisa, restock, status, reason,
          notes, client_ref, created_at, created_by)
       VALUES (?, ?, 'sale', ?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?)`,
      [
        returnId,
        docNo,
        sale.id,
        sale.invoice_no,
        sale.customer_id,
        sale.customer_name,
        at,
        total,
        total,
        input.refundMethodId ?? null,
        input.refundMethodId ? total : 0,
        restock ? 1 : 0,
        input.reason,
        input.notes ?? null,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );

    for (const p of prepared) {
      await tx.exec(
        `INSERT INTO return_lines (id, return_id, product_id, product_name, sale_line_id, unit_code, qty_micro,
            factor_micro, base_qty_micro, unit_price_paisa, unit_cost_paisa, line_total_paisa, damage_qty_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('rln'),
          returnId,
          p.line.product_id,
          p.line.product_name,
          p.line.id,
          p.line.unit_code,
          p.qtyMicro,
          p.line.factor_micro,
          p.baseQtyMicro,
          p.line.unit_price_paisa,
          p.line.unit_cost_paisa,
          p.creditPaisa,
          p.damageMicro,
        ],
      );
      await tx.exec('UPDATE sale_lines SET returned_qty_micro = returned_qty_micro + ? WHERE id = ?', [
        p.qtyMicro,
        p.line.id,
      ]);

      const usableBase = p.baseQtyMicro - mulDivRound(p.damageMicro, Number(p.line.factor_micro), QTY_SCALE);
      if (restock && usableBase > 0) {
        await applyStockMovement(tx, {
          productId: p.line.product_id,
          deltaMicro: usableBase,
          type: 'sale_return',
          unitCode: p.line.unit_code,
          enteredQtyMicro: p.qtyMicro - p.damageMicro,
          factorMicro: Number(p.line.factor_micro),
          unitCostPaisa: Number(p.line.unit_cost_paisa),
          docType: 'sale_return',
          docId: returnId,
          docNo,
          reason: `Return: ${input.reason}`,
          actorName: input.actor.name,
          at,
          allowNegative: settings.allowNegativeStock,
        });
      }
    }

    if (sale.customer_id) {
      if (input.refundMethodId) {
        const method = await loadPaymentMethod(tx, input.refundMethodId);
        await postPayment(tx, {
          partyType: 'customer',
          partyId: sale.customer_id,
          partyName: sale.customer_name,
          amountPaisa: total,
          methodId: input.refundMethodId,
          direction: 'out',
          docType: 'sale_return',
          docId: returnId,
          paidAt: at,
          actor: input.actor,
          skipLedger: true,
          skipCash: true,
        });
        if (Number(method.is_cash) === 1) {
          const shift = await ensureShift(tx, input.actor);
          await postCashMovement(tx, {
            shiftId: shift.id,
            direction: 'out',
            amountPaisa: total,
            sourceType: 'sale_refund',
            sourceId: returnId,
            description: `Refund ${docNo}`,
            actor: input.actor,
            at,
          });
        }
      } else {
        await postLedger(tx, {
          partyType: 'customer',
          partyId: sale.customer_id,
          at,
          docType: 'sale_return',
          docId: returnId,
          description: `Credit note ${docNo} (${sale.invoice_no})`,
          creditPaisa: total,
          actorName: input.actor.name,
        });
      }
    }

    await audit(tx, {
      actor: input.actor,
      action: 'sale.return',
      entity: 'sale',
      entityId: sale.id,
      details: { docNo, total, refunded: input.refundMethodId ? total : 0, cogsReversed: totalCogs },
    });

    return {
      returnId,
      docNo,
      totalPaisa: total,
      refundedPaisa: input.refundMethodId ? total : 0,
      creditNotePaisa: input.refundMethodId ? 0 : total,
    };
  });
}

export interface PurchaseReturnLineInput {
  purchaseLineId: string;
  qtyMicro: number;
}

export interface PurchaseReturnInput {
  purchaseId: string;
  lines: PurchaseReturnLineInput[];
  /** When omitted, the supplier ledger is debited (credit note from supplier). */
  refundMethodId?: string | null;
  reason: string;
  notes?: string | null;
  clientRef?: string | null;
  returnedAt?: string;
  actor: Actor;
}

export async function createPurchaseReturn(
  db: Database,
  input: PurchaseReturnInput,
): Promise<ReturnResult> {
  assertCan(input.actor.role, 'purchase.manage');
  if (!input.reason.trim()) {throw new ValidationError('A reason is required for returns', 'reason');}
  return db.tx(async tx => {
    const purchase = await tx.one<PurchaseRow>('SELECT * FROM purchases WHERE id = ?', [input.purchaseId]);
    if (!purchase) {throw new NotFoundError('Purchase', input.purchaseId);}
    if (purchase.status !== 'posted') {throw new BusinessError('Only posted purchases can be returned');}
    const settings = await loadSettings(tx);
    const at = input.returnedAt ?? nowIso();

    let total = 0;
    const prepared: { line: Record<string, string | number>; qtyMicro: number; baseQtyMicro: number; creditPaisa: number }[] = [];
    for (const item of input.lines) {
      const line = await tx.one<Record<string, string | number>>(
        'SELECT * FROM purchase_lines WHERE id = ? AND purchase_id = ?',
        [item.purchaseLineId, purchase.id],
      );
      if (!line) {throw new NotFoundError('Purchase line', item.purchaseLineId);}
      const qty = Math.round(item.qtyMicro);
      if (qty <= 0) {continue;}
      if (qty > Number(line.qty_micro)) {
        throw new ValidationError('Return quantity exceeds the purchased quantity', 'qty');
      }
      const baseQty = mulDivRound(qty, Number(line.factor_micro), QTY_SCALE);
      const credit = mulDivRound(Number(line.line_total_paisa), qty, Number(line.qty_micro));
      total += credit;
      prepared.push({ line, qtyMicro: qty, baseQtyMicro: baseQty, creditPaisa: credit });
    }
    if (!prepared.length) {throw new ValidationError('Select at least one line to return', 'lines');}

    const docNo = await nextDocNo(tx, { scope: 'purchase_return', prefix: `${settings.returnPrefix}-PR`, date: new Date(at) });
    const returnId = newId('ret');
    await tx.exec(
      `INSERT INTO returns (id, doc_no, type, original_id, original_no, party_type, party_id, party_name,
          returned_at, subtotal_paisa, total_paisa, refund_method_id, refunded_paisa, restock, status, reason,
          notes, client_ref, created_at, created_by)
       VALUES (?, ?, 'purchase', ?, ?, 'supplier', ?, ?, ?, ?, ?, ?, ?, 0, 'posted', ?, ?, ?, ?, ?)`,
      [
        returnId,
        docNo,
        purchase.id,
        purchase.doc_no,
        purchase.supplier_id,
        purchase.supplier_name,
        at,
        total,
        total,
        input.refundMethodId ?? null,
        input.refundMethodId ? total : 0,
        input.reason,
        input.notes ?? null,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );

    for (const p of prepared) {
      await tx.exec(
        `INSERT INTO return_lines (id, return_id, product_id, product_name, purchase_line_id, unit_code, qty_micro,
            factor_micro, base_qty_micro, unit_price_paisa, unit_cost_paisa, line_total_paisa, damage_qty_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          newId('rln'),
          returnId,
          String(p.line.product_id),
          String(p.line.product_name),
          String(p.line.id),
          String(p.line.unit_code),
          p.qtyMicro,
          Number(p.line.factor_micro),
          p.baseQtyMicro,
          Number(p.line.unit_cost_paisa),
          Number(p.line.cost_per_base_paisa),
          p.creditPaisa,
        ],
      );
      await applyStockMovement(tx, {
        productId: String(p.line.product_id),
        deltaMicro: -p.baseQtyMicro,
        type: 'purchase_return',
        unitCode: String(p.line.unit_code),
        enteredQtyMicro: p.qtyMicro,
        factorMicro: Number(p.line.factor_micro),
        unitCostPaisa: Number(p.line.cost_per_base_paisa),
        docType: 'purchase_return',
        docId: returnId,
        docNo,
        reason: `Purchase return: ${input.reason}`,
        actorName: input.actor.name,
        at,
        allowNegative: settings.allowNegativeStock,
      });
    }

    if (purchase.supplier_id) {
      if (input.refundMethodId) {
        const method = await loadPaymentMethod(tx, input.refundMethodId);
        await postPayment(tx, {
          partyType: 'supplier',
          partyId: purchase.supplier_id,
          partyName: purchase.supplier_name,
          amountPaisa: total,
          methodId: input.refundMethodId,
          direction: 'in',
          docType: 'purchase_return',
          docId: returnId,
          paidAt: at,
          actor: input.actor,
          skipLedger: true,
          skipCash: true,
        });
        if (Number(method.is_cash) === 1) {
          const shift = await ensureShift(tx, input.actor);
          await postCashMovement(tx, {
            shiftId: shift.id,
            direction: 'in',
            amountPaisa: total,
            sourceType: 'adjustment',
            sourceId: returnId,
            description: `Supplier refund ${docNo}`,
            actor: input.actor,
            at,
          });
        }
      } else {
        await postLedger(tx, {
          partyType: 'supplier',
          partyId: purchase.supplier_id,
          at,
          docType: 'purchase_return',
          docId: returnId,
          description: `Purchase return ${docNo} (${purchase.doc_no})`,
          debitPaisa: total,
          actorName: input.actor.name,
        });
      }
    }

    await audit(tx, {
      actor: input.actor,
      action: 'purchase.return',
      entity: 'purchase',
      entityId: purchase.id,
      details: { docNo, total },
    });

    return {
      returnId,
      docNo,
      totalPaisa: total,
      refundedPaisa: input.refundMethodId ? total : 0,
      creditNotePaisa: input.refundMethodId ? 0 : total,
    };
  });
}

export async function listReturns(db: Database, limit = 50, type?: 'sale' | 'purchase') {
  const rows = type
    ? await db.query('SELECT * FROM returns WHERE type = ? ORDER BY returned_at DESC LIMIT ?', [type, limit])
    : await db.query('SELECT * FROM returns ORDER BY returned_at DESC LIMIT ?', [limit]);
  return rows;
}
