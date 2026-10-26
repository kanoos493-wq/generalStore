/**
 * Sales / POS service.
 *
 * One call to `createSale` atomically: prices the cart from product data,
 * enforces stock and credit rules, writes the invoice + immutable lines with
 * transaction-time cost, records stock movements, payment rows, ledger entries
 * and cash drawer movements, or rolls the whole thing back.
 */
import type { Database, Tx } from '../db/database';
import type { ProductRow, SaleLineRow, SaleRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import {
  BusinessError,
  CreditLimitExceededError,
  NotFoundError,
  ValidationError,
} from '../core/errors';
import { assertCan, can, type Actor } from '../core/permissions';
import { bpOf, mulDivRound, QTY_SCALE, sumMoney } from '../core/money';
import { deriveUnitPrice, lineTotal } from '../core/pricing';
import { defaultFactorMicro } from '../core/units';
import { likePattern, normalizeSearch } from '../core/text';
import { audit } from './auditService';
import { ensureShift, isCashMethod, postCashMovement } from './cashService';
import { postLedger } from './ledgerService';
import { postPayment, loadPaymentMethod } from './paymentService';
import { loadSettings, type StoreSettings } from './settingsService';
import { applyStockMovement } from './stockService';
import { nextDocNo } from './numbering';

export interface SaleLineInput {
  productId: string;
  unitCode: string;
  /** Quantity in the entered unit (micro). */
  qtyMicro: number;
  factorMicro?: number | null;
  unitPricePaisa?: number | null;
  lineDiscountPaisa?: number;
}

export interface SalePaymentInput {
  methodId: string;
  amountPaisa: number;
  reference?: string | null;
}

export interface SaleInput {
  lines: SaleLineInput[];
  customerId?: string | null;
  payments?: SalePaymentInput[];
  discountPaisa?: number;
  discountBp?: number;
  notes?: string | null;
  soldAt?: string;
  clientRef?: string | null;
  actor: Actor;
  /** Manager approval for a discount above the configured limit. */
  discountApproved?: boolean;
  /** Manager approval to exceed a customer credit limit. */
  creditApproved?: boolean;
}

export interface SaleResult {
  saleId: string;
  invoiceNo: string;
  soldAt: string;
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  creditPaisa: number;
  changePaisa: number;
  duplicate: boolean;
}

export async function resolveSaleUnit(
  tx: Tx,
  product: ProductRow,
  unitCode: string,
  explicitFactor?: number | null,
): Promise<{ factorMicro: number; priceOverridePaisa: number | null }> {
  if (explicitFactor && explicitFactor > 0) {
    const unit = await tx.one<{ price_paisa: number | null }>(
      `SELECT price_paisa FROM product_units WHERE product_id = ? AND unit_code = ? AND kind = 'sale'`,
      [product.id, unitCode],
    );
    return { factorMicro: explicitFactor, priceOverridePaisa: unit?.price_paisa ?? null };
  }
  const row = await tx.one<{ factor_micro: number; price_paisa: number | null }>(
    `SELECT factor_micro, price_paisa FROM product_units WHERE product_id = ? AND unit_code = ? AND kind = 'sale'`,
    [product.id, unitCode],
  );
  if (row) {
    return { factorMicro: Number(row.factor_micro), priceOverridePaisa: row.price_paisa };
  }
  if (unitCode === product.base_unit) {
    return { factorMicro: QTY_SCALE, priceOverridePaisa: null };
  }
  const derived = defaultFactorMicro(product.base_unit, unitCode);
  if (derived) {
    return { factorMicro: derived, priceOverridePaisa: null };
  }
  throw new ValidationError(`Unit ${unitCode} is not configured for ${product.name_en}`, 'unit');
}

export interface PricedLine {
  product: ProductRow;
  unitCode: string;
  qtyMicro: number;
  factorMicro: number;
  baseQtyMicro: number;
  unitPricePaisa: number;
  lineDiscountPaisa: number;
  netPaisa: number;
  taxPaisa: number;
  unitCostPaisa: number;
}

export async function priceSaleLines(
  tx: Tx,
  lines: SaleLineInput[],
  settings: StoreSettings,
): Promise<{ priced: PricedLine[]; subtotalPaisa: number; taxPaisa: number; lineDiscountPaisa: number }> {
  if (!lines.length) {throw new ValidationError('Add at least one product to the sale', 'lines');}
  const priced: PricedLine[] = [];
  let subtotal = 0;
  let tax = 0;
  let lineDiscounts = 0;

  for (const line of lines) {
    const product = await tx.one<ProductRow>('SELECT * FROM products WHERE id = ?', [line.productId]);
    if (!product) {throw new NotFoundError('Product', line.productId);}
    if (!product.is_active) {throw new ValidationError(`${product.name_en} is inactive`, 'product');}
    const qty = Math.round(line.qtyMicro);
    if (qty <= 0) {throw new ValidationError('Quantity must be greater than zero', 'qty');}

    const { factorMicro, priceOverridePaisa } = await resolveSaleUnit(
      tx,
      product,
      line.unitCode,
      line.factorMicro,
    );
    if (factorMicro <= 0) {throw new ValidationError('Invalid conversion factor', 'factor');}
    const baseQty = mulDivRound(qty, factorMicro, QTY_SCALE);
    if (baseQty <= 0) {throw new ValidationError('Quantity is too small to record', 'qty');}

    let unitPrice: number;
    if (line.unitPricePaisa !== undefined && line.unitPricePaisa !== null) {
      unitPrice = Math.round(line.unitPricePaisa);
    } else if (priceOverridePaisa !== null && priceOverridePaisa !== undefined) {
      unitPrice = Math.round(priceOverridePaisa);
    } else {
      unitPrice = deriveUnitPrice(Number(product.sale_price_paisa), factorMicro, settings.priceRounding);
    }
    if (unitPrice < 0) {throw new ValidationError('Price cannot be negative', 'price');}

    const gross = lineTotal(unitPrice, qty);
    const lineDiscount = Math.round(line.lineDiscountPaisa ?? 0);
    if (lineDiscount < 0) {throw new ValidationError('Discount cannot be negative', 'discount');}
    if (lineDiscount > gross) {throw new ValidationError('Line discount exceeds line total', 'discount');}
    const net = gross - lineDiscount;
    const taxBp = settings.taxEnabled ? Number(product.tax_bp ?? settings.defaultTaxBp) : 0;
    const lineTax = taxBp > 0 ? bpOf(net, taxBp) : 0;

    subtotal += gross;
    tax += lineTax;
    lineDiscounts += lineDiscount;
    priced.push({
      product,
      unitCode: line.unitCode,
      qtyMicro: qty,
      factorMicro,
      baseQtyMicro: baseQty,
      unitPricePaisa: unitPrice,
      lineDiscountPaisa: lineDiscount,
      netPaisa: net,
      taxPaisa: lineTax,
      unitCostPaisa: Number(product.cost_paisa),
    });
  }
  return { priced, subtotalPaisa: subtotal, taxPaisa: tax, lineDiscountPaisa: lineDiscounts };
}

export async function createSale(db: Database, input: SaleInput): Promise<SaleResult> {
  assertCan(input.actor.role, 'sale.create');

  if (input.clientRef) {
    const existing = await db.one<SaleRow>('SELECT * FROM sales WHERE client_ref = ?', [input.clientRef]);
    if (existing) {
      const paid = Number(existing.paid_paisa);
      const total = Number(existing.total_paisa);
      return {
        saleId: existing.id,
        invoiceNo: existing.invoice_no,
        soldAt: existing.sold_at,
        subtotalPaisa: Number(existing.subtotal_paisa),
        discountPaisa: Number(existing.discount_paisa),
        taxPaisa: Number(existing.tax_paisa),
        totalPaisa: total,
        paidPaisa: paid,
        creditPaisa: Number(existing.credit_paisa),
        changePaisa: 0,
        duplicate: true,
      };
    }
  }

  return db.tx(async tx => {
    const settings = await loadSettings(tx);
    const at = input.soldAt ?? nowIso();
    const { priced, subtotalPaisa, taxPaisa, lineDiscountPaisa } = await priceSaleLines(
      tx,
      input.lines,
      settings,
    );

    const subtotalAfterLines = subtotalPaisa - lineDiscountPaisa;
    const bpDiscount = Math.round(input.discountBp ?? 0) > 0 ? bpOf(subtotalAfterLines, Math.round(input.discountBp!)) : 0;
    const fixedDiscount = Math.round(input.discountPaisa ?? 0);
    if (bpDiscount < 0 || fixedDiscount < 0) {throw new ValidationError('Discount cannot be negative', 'discount');}
    const cartDiscount = bpDiscount + fixedDiscount;
    if (cartDiscount > subtotalAfterLines) {
      throw new ValidationError('Discount cannot exceed the bill subtotal', 'discount');
    }

    const totalDiscount = lineDiscountPaisa + cartDiscount;
    const limitPaisa = bpOf(subtotalPaisa, settings.discountLimitBp);
    if (totalDiscount > limitPaisa && !input.discountApproved && !can(input.actor.role, 'sale.discount.override')) {
      throw new BusinessError(
        `Discount exceeds the ${(settings.discountLimitBp / 100).toFixed(1)}% limit; manager approval required`,
        'discount_limit',
      );
    }

    const total = subtotalAfterLines - cartDiscount + taxPaisa;
    if (total < 0) {throw new ValidationError('Bill total cannot be negative');}
    if (total === 0 && priced.every(p => p.netPaisa === 0)) {
      throw new ValidationError('Bill total cannot be zero');
    }

    // ---- payments (tendered amounts are capped at the bill total) ----
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
    const tendered = sumMoney(tenderInputs.map(p => Math.max(0, Math.round(p.amountPaisa))));
    const change = Math.max(0, tendered - appliedTotal);

    // ---- credit rules ----
    const credit = total - appliedTotal;
    if (credit > 0) {
      if (!input.customerId) {
        throw new BusinessError(
          'Walk-in sales must be paid in full. Select a customer to sell on credit.',
          'walkin_credit',
        );
      }
    }

    let customerName: string | null = null;
    if (input.customerId) {
      const customer = await tx.one<{ name_en: string; balance_paisa: number; credit_limit_paisa: number; is_active: number }>(
        'SELECT name_en, balance_paisa, credit_limit_paisa, is_active FROM customers WHERE id = ?',
        [input.customerId],
      );
      if (!customer) {throw new NotFoundError('Customer', input.customerId);}
      if (!customer.is_active) {throw new ValidationError('Customer is inactive', 'customer');}
      customerName = customer.name_en;
      const limit = Number(customer.credit_limit_paisa);
      const resulting = Number(customer.balance_paisa) + credit;
      if (credit > 0 && limit > 0 && resulting > limit && !input.creditApproved) {
        throw new CreditLimitExceededError(customer.name_en, limit, resulting);
      }
    }

    // ---- invoice ----
    const invoiceNo = await nextDocNo(tx, {
      scope: 'sale',
      prefix: settings.invoicePrefix,
      date: new Date(at),
    });
    const saleId = newId('sale');
    await tx.exec(
      `INSERT INTO sales (id, invoice_no, customer_id, customer_name, sold_at, subtotal_paisa, discount_paisa,
          tax_paisa, total_paisa, paid_paisa, credit_paisa, status, notes, client_ref, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`,
      [
        saleId,
        invoiceNo,
        input.customerId ?? null,
        customerName,
        at,
        subtotalPaisa,
        lineDiscountPaisa + cartDiscount,
        taxPaisa,
        total,
        appliedTotal,
        credit,
        input.notes ?? null,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );

    const shift = applied.some(p => p.amountPaisa > 0) ? await ensureShift(tx, input.actor) : null;
    if (shift) {
      await tx.exec('UPDATE sales SET shift_id = ? WHERE id = ?', [shift.id, saleId]);
    }

    // ---- lines + stock ----
    for (const line of priced) {
      const lineId = newId('sln');
      const cogs = mulDivRound(line.baseQtyMicro, line.unitCostPaisa, QTY_SCALE);
      await tx.exec(
        `INSERT INTO sale_lines (id, sale_id, product_id, product_name, unit_code, qty_micro, factor_micro,
            base_qty_micro, unit_price_paisa, line_discount_paisa, line_total_paisa, unit_cost_paisa, cogs_paisa,
            returned_qty_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          lineId,
          saleId,
          line.product.id,
          line.product.name_en,
          line.unitCode,
          line.qtyMicro,
          line.factorMicro,
          line.baseQtyMicro,
          line.unitPricePaisa,
          line.lineDiscountPaisa,
          line.netPaisa,
          line.unitCostPaisa,
          cogs,
        ],
      );
      await applyStockMovement(tx, {
        productId: line.product.id,
        deltaMicro: -line.baseQtyMicro,
        type: 'sale',
        unitCode: line.unitCode,
        enteredQtyMicro: line.qtyMicro,
        factorMicro: line.factorMicro,
        unitCostPaisa: line.unitCostPaisa,
        docType: 'sale',
        docId: saleId,
        docNo: invoiceNo,
        reason: 'Sale',
        actorName: input.actor.name,
        at,
        allowNegative: settings.allowNegativeStock,
      });
    }

    // ---- payments ----
    for (const p of applied) {
      await postPayment(tx, {
        partyType: 'customer',
        partyId: input.customerId ?? null,
        partyName: customerName,
        amountPaisa: p.amountPaisa,
        methodId: p.methodId,
        direction: 'in',
        docType: 'sale',
        docId: saleId,
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
          direction: 'in',
          amountPaisa: p.amountPaisa,
          sourceType: 'sale',
          sourceId: saleId,
          description: `Cash sale ${invoiceNo}`,
          actor: input.actor,
          at,
        });
      }
    }

    // ---- customer khata ----
    if (input.customerId) {
      await postLedger(tx, {
        partyType: 'customer',
        partyId: input.customerId,
        at,
        docType: 'sale',
        docId: saleId,
        description: `Invoice ${invoiceNo}`,
        debitPaisa: total,
        actorName: input.actor.name,
      });
      for (const p of applied) {
        await postLedger(tx, {
          partyType: 'customer',
          partyId: input.customerId,
          at,
          docType: 'payment',
          docId: saleId,
          description: `Payment - ${invoiceNo}`,
          creditPaisa: p.amountPaisa,
          actorName: input.actor.name,
        });
      }
    }

    await audit(tx, {
      actor: input.actor,
      action: 'sale.create',
      entity: 'sale',
      entityId: saleId,
      details: {
        invoiceNo,
        total,
        paid: appliedTotal,
        credit,
        lines: priced.length,
        discount: lineDiscountPaisa + cartDiscount,
      },
    });

    return {
      saleId,
      invoiceNo,
      soldAt: at,
      subtotalPaisa,
      discountPaisa: lineDiscountPaisa + cartDiscount,
      taxPaisa,
      totalPaisa: total,
      paidPaisa: appliedTotal,
      creditPaisa: credit,
      changePaisa: change,
      duplicate: false,
    };
  });
}

/** Manager-only audited reversal of a posted sale (stock + ledger restored). */
export async function voidSale(
  db: Database,
  input: { saleId: string; reason: string; actor: Actor },
): Promise<void> {
  assertCan(input.actor.role, 'settings.manage');
  await db.tx(async tx => {
    const sale = await tx.one<SaleRow>('SELECT * FROM sales WHERE id = ?', [input.saleId]);
    if (!sale) {throw new NotFoundError('Sale', input.saleId);}
    if (sale.status !== 'posted') {throw new BusinessError('Only posted sales can be voided');}
    if (Number(sale.credit_paisa) === 0 && Number(sale.paid_paisa) === 0) {
      throw new BusinessError('Sale has no financial effect');
    }
    const settings = await loadSettings(tx);
    const at = nowIso();
    const lines = await tx.query('SELECT * FROM sale_lines WHERE sale_id = ?', [sale.id]);
    for (const line of lines) {
      await applyStockMovement(tx, {
        productId: String(line.product_id),
        deltaMicro: Number(line.base_qty_micro),
        type: 'sale_return',
        unitCode: String(line.unit_code),
        enteredQtyMicro: Number(line.qty_micro),
        factorMicro: Number(line.factor_micro),
        unitCostPaisa: Number(line.unit_cost_paisa),
        docType: 'sale_void',
        docId: sale.id,
        docNo: sale.invoice_no,
        reason: `Void: ${input.reason}`,
        actorName: input.actor.name,
        at,
        allowNegative: true,
      });
    }
    if (sale.customer_id) {
      await postLedger(tx, {
        partyType: 'customer',
        partyId: sale.customer_id,
        at,
        docType: 'sale_void',
        docId: sale.id,
        description: `Voided invoice ${sale.invoice_no}: ${input.reason}`,
        creditPaisa: Number(sale.total_paisa),
        actorName: input.actor.name,
      });
    }
    await tx.exec(
      `UPDATE sales SET status = 'reversed', reversed_at = ?, reversal_reason = ? WHERE id = ?`,
      [at, input.reason, sale.id],
    );
    await audit(tx, {
      actor: input.actor,
      action: 'sale.void',
      entity: 'sale',
      entityId: sale.id,
      details: { reason: input.reason, invoiceNo: sale.invoice_no, total: sale.total_paisa },
    });
    void settings;
  });
}

export interface SaleListFilters {
  from?: string;
  to?: string;
  query?: string;
  customerId?: string;
  status?: string;
  limit?: number;
  beforeSoldAt?: string;
  beforeId?: string;
}

export interface SaleListRow extends SaleRow {
  line_count: number;
}

export async function listSales(db: Database, filters: SaleListFilters = {}): Promise<SaleListRow[]> {
  const limit = Math.min(filters.limit ?? 40, 200);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.from) {where.push('s.sold_at >= ?'); params.push(filters.from);}
  if (filters.to) {where.push('s.sold_at <= ?'); params.push(filters.to);}
  if (filters.status) {where.push('s.status = ?'); params.push(filters.status);}
  if (filters.customerId) {where.push('s.customer_id = ?'); params.push(filters.customerId);}
  if (filters.query) {
    where.push('(s.invoice_no LIKE ? ESCAPE \'\\\' OR s.customer_name LIKE ? ESCAPE \'\\\')');
    params.push(likePattern(filters.query), likePattern(filters.query));
  }
  if (filters.beforeSoldAt) {
    where.push('(s.sold_at < ? OR (s.sold_at = ? AND s.id < ?))');
    params.push(filters.beforeSoldAt, filters.beforeSoldAt, filters.beforeId ?? '');
  }
  const sql = `SELECT s.*, (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id = s.id) AS line_count
     FROM sales s
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.sold_at DESC, s.id DESC
     LIMIT ?`;
  params.push(limit);
  const rows = await db.query(sql, params);
  return rows as unknown as SaleListRow[];
}

export async function saleDetail(db: Database, saleId: string) {
  const sale = await db.one<SaleRow>('SELECT * FROM sales WHERE id = ?', [saleId]);
  if (!sale) {throw new NotFoundError('Sale', saleId);}
  const lines = (await db.query('SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY rowid', [
    saleId,
  ])) as unknown as SaleLineRow[];
  const payments = await db.query('SELECT * FROM payments WHERE doc_type = ? AND doc_id = ? ORDER BY paid_at', [
    'sale',
    saleId,
  ]);
  const returns = await db.query('SELECT * FROM returns WHERE original_id = ? ORDER BY returned_at', [saleId]);
  return { sale, lines, payments, returns };
}

export async function searchCustomerForSale(db: Database, query: string, limit = 20) {
  const q = normalizeSearch(query);
  if (!q) {return [];}
  return db.query(
    `SELECT id, name_en, name_ur, phone, balance_paisa, credit_limit_paisa
     FROM customers WHERE is_active = 1 AND search_blob LIKE ? ESCAPE '\\'
     ORDER BY name_en LIMIT ?`,
    [likePattern(q), limit],
  );
}
