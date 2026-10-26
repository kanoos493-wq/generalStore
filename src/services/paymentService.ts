/**
 * Payment records + allocations.
 * A payment is always stored as its own row (with method, reference and
 * document link) and mirrored into the party ledger and cash drawer.
 */
import type { Database, Tx } from '../db/database';
import type { PaymentMethodRow, PaymentRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { ValidationError, NotFoundError, BusinessError } from '../core/errors';
import { isOverpayment } from '../core/ledger';
import { assertCan, type Actor } from '../core/permissions';
import type { PartyType } from '../core/ledger';
import { audit } from './auditService';
import { isCashMethod, ensureShift, postCashMovement } from './cashService';
import { partyBalance, postLedger } from './ledgerService';

export interface PostPaymentInput {
  partyType: PartyType;
  /** Null for anonymous walk-in sales (no ledger, payment record only). */
  partyId: string | null;
  partyName?: string | null;
  amountPaisa: number;
  methodId: string;
  direction: 'in' | 'out';
  docType: string;
  docId?: string | null;
  paidAt?: string;
  reference?: string | null;
  notes?: string | null;
  clientRef?: string | null;
  actor: Actor;
  /** The caller already posted the ledger entry (e.g. invoice creation). */
  skipLedger?: boolean;
  /** The caller already posted the cash movement. */
  skipCash?: boolean;
}

export interface PostPaymentResult {
  paymentId: string;
  method: PaymentMethodRow;
  newBalancePaisa: number | null;
}

export async function loadPaymentMethod(tx: Tx, methodId: string): Promise<PaymentMethodRow> {
  const row = await tx.one<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ?', [methodId]);
  if (!row) {throw new NotFoundError('Payment method', methodId);}
  if (!row.is_active) {throw new ValidationError(`Payment method ${row.name_en} is disabled`);}
  return row;
}

export async function postPayment(tx: Tx, input: PostPaymentInput): Promise<PostPaymentResult> {
  const amount = Math.round(input.amountPaisa);
  if (amount <= 0) {throw new ValidationError('Payment amount must be greater than zero', 'amount');}
  const method = await loadPaymentMethod(tx, input.methodId);
  if (method.is_credit) {
    throw new BusinessError('Credit is not a payment method; leave the amount unpaid instead', 'credit_method');
  }

  const at = input.paidAt ?? nowIso();
  const paymentId = newId('pay');
  await tx.exec(
    `INSERT INTO payments (id, party_type, party_id, party_name, direction, method_id, amount_paisa,
        paid_at, doc_type, doc_id, reference, notes, is_void, client_ref, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      paymentId,
      input.partyType,
      input.partyId,
      input.partyName ?? null,
      input.direction,
      input.methodId,
      amount,
      at,
      input.docType,
      input.docId ?? null,
      input.reference ?? null,
      input.notes ?? null,
      input.clientRef ?? null,
      at,
      input.actor.name,
    ],
  );

  let newBalance: number | null = null;
  if (!input.skipLedger && input.partyId) {
    newBalance = await postLedger(tx, {
      partyType: input.partyType,
      partyId: input.partyId,
      at,
      docType: input.docType,
      docId: input.docId ?? paymentId,
      description:
        input.partyType === 'customer' ? `Payment received (${method.name_en})` : `Payment made (${method.name_en})`,
      debitPaisa: input.partyType === 'supplier' ? amount : 0,
      creditPaisa: input.partyType === 'customer' ? amount : 0,
      actorName: input.actor.name,
    });
  }

  if (!input.skipCash && Number(method.is_cash) === 1) {
    const shift = await ensureShift(tx, input.actor);
    await postCashMovement(tx, {
      shiftId: shift.id,
      direction: input.direction,
      amountPaisa: amount,
      sourceType: input.partyType === 'customer' ? 'customer_payment' : 'supplier_payment',
      sourceId: paymentId,
      description:
        input.partyType === 'customer'
          ? `Cash received - ${input.partyName ?? 'customer'}`
          : `Cash paid - ${input.partyName ?? 'supplier'}`,
      actor: input.actor,
      at,
    });
  }

  return { paymentId, method, newBalancePaisa: newBalance };
}

export interface ReceiptInput {
  customerId: string;
  amountPaisa: number;
  methodId: string;
  paidAt?: string;
  reference?: string;
  notes?: string;
  clientRef?: string;
  actor: Actor;
  allowAdvance?: boolean;
}

/** Receive money from a customer against their khata (no new sale). */
export async function receiveCustomerPayment(db: Database, input: ReceiptInput): Promise<PostPaymentResult> {
  assertCan(input.actor.role, 'payment.record');
  return db.tx(async tx => {
    const customer = await tx.one<{ name_en: string; balance_paisa: number }>(
      'SELECT name_en, balance_paisa FROM customers WHERE id = ?',
      [input.customerId],
    );
    if (!customer) {throw new NotFoundError('Customer', input.customerId);}
    const balance = Number(customer.balance_paisa);
    if (!input.allowAdvance && isOverpayment(input.amountPaisa, balance) && balance > 0) {
      throw new ValidationError(
        `Amount exceeds outstanding balance (${(balance / 100).toFixed(2)})`,
        'amount',
      );
    }
    const result = await postPayment(tx, {
      partyType: 'customer',
      partyId: input.customerId,
      partyName: customer.name_en,
      amountPaisa: input.amountPaisa,
      methodId: input.methodId,
      direction: 'in',
      docType: 'receipt',
      paidAt: input.paidAt,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      clientRef: input.clientRef ?? null,
      actor: input.actor,
    });
    await audit(tx, {
      actor: input.actor,
      action: 'customer.payment',
      entity: 'customer',
      entityId: input.customerId,
      details: { amount: input.amountPaisa, method: result.method.code },
    });
    return result;
  });
}

export interface SupplierPaymentInput {
  supplierId: string;
  amountPaisa: number;
  methodId: string;
  paidAt?: string;
  reference?: string;
  notes?: string;
  clientRef?: string;
  actor: Actor;
  allowAdvance?: boolean;
}

/** Pay a supplier against their ledger. */
export async function paySupplier(db: Database, input: SupplierPaymentInput): Promise<PostPaymentResult> {
  assertCan(input.actor.role, 'payment.record');
  return db.tx(async tx => {
    const supplier = await tx.one<{ name_en: string; balance_paisa: number }>(
      'SELECT name_en, balance_paisa FROM suppliers WHERE id = ?',
      [input.supplierId],
    );
    if (!supplier) {throw new NotFoundError('Supplier', input.supplierId);}
    const balance = Number(supplier.balance_paisa);
    if (!input.allowAdvance && isOverpayment(input.amountPaisa, balance) && balance > 0) {
      throw new ValidationError(
        `Amount exceeds outstanding payable (${(balance / 100).toFixed(2)})`,
        'amount',
      );
    }
    const result = await postPayment(tx, {
      partyType: 'supplier',
      partyId: input.supplierId,
      partyName: supplier.name_en,
      amountPaisa: input.amountPaisa,
      methodId: input.methodId,
      direction: 'out',
      docType: 'supplier_payment',
      paidAt: input.paidAt,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      clientRef: input.clientRef ?? null,
      actor: input.actor,
    });
    await audit(tx, {
      actor: input.actor,
      action: 'supplier.payment',
      entity: 'supplier',
      entityId: input.supplierId,
      details: { amount: input.amountPaisa, method: result.method.code },
    });
    return result;
  });
}

/** Void a payment with an audited reversal (no rows are deleted). */
export async function voidPayment(
  db: Database,
  input: { paymentId: string; reason: string; actor: Actor },
): Promise<void> {
  assertCan(input.actor.role, 'settings.manage');
  await db.tx(async tx => {
    const payment = await tx.one<PaymentRow>('SELECT * FROM payments WHERE id = ?', [input.paymentId]);
    if (!payment) {throw new NotFoundError('Payment', input.paymentId);}
    if (payment.is_void) {throw new BusinessError('Payment is already voided');}
    const amount = Number(payment.amount_paisa);
    const at = nowIso();
    await tx.exec('UPDATE payments SET is_void = 1, notes = COALESCE(notes, ?) WHERE id = ?', [
      `voided: ${input.reason}`,
      payment.id,
    ]);
    if (payment.party_id) {
      await postLedger(tx, {
        partyType: payment.party_type,
        partyId: payment.party_id,
        at,
        docType: 'payment_void',
        docId: payment.id,
        description: `Payment voided: ${input.reason}`,
        debitPaisa: payment.party_type === 'customer' ? amount : 0,
        creditPaisa: payment.party_type === 'supplier' ? amount : 0,
        actorName: input.actor.name,
      });
    }
    const cash = await isCashMethod(tx, payment.method_id);
    if (cash) {
      const shift = await ensureShift(tx, input.actor);
      await postCashMovement(tx, {
        shiftId: shift.id,
        direction: payment.direction === 'in' ? 'out' : 'in',
        amountPaisa: amount,
        sourceType: 'adjustment',
        sourceId: payment.id,
        description: `Reversal of payment: ${input.reason}`,
        actor: input.actor,
      });
    }
    await audit(tx, {
      actor: input.actor,
      action: 'payment.void',
      entity: 'payment',
      entityId: payment.id,
      details: { reason: input.reason, amount },
    });
  });
}

export async function openInvoiceBalance(tx: Tx, partyType: PartyType, partyId: string): Promise<number> {
  return partyBalance(tx, partyType, partyId);
}

export async function paymentMethods(db: Database): Promise<PaymentMethodRow[]> {
  const rows = await db.query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort, name_en');
  return rows as unknown as PaymentMethodRow[];
}

export async function paymentMethodById(db: Database, id: string): Promise<PaymentMethodRow | undefined> {
  return db.one<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ?', [id]);
}
