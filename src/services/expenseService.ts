/** Daily expenses: cash and non-cash, with audited voiding. */
import type { Database } from '../db/database';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { audit } from './auditService';
import { ensureShift, isCashMethod, postCashMovement } from './cashService';
import { loadSettings } from './settingsService';
import { nextDocNo } from './numbering';

export interface ExpenseInput {
  categoryId: string;
  description: string;
  amountPaisa: number;
  methodId: string;
  spentAt?: string;
  payee?: string | null;
  reference?: string | null;
  notes?: string | null;
  clientRef?: string | null;
  actor: Actor;
}

export async function createExpense(
  db: Database,
  input: ExpenseInput,
): Promise<{ id: string; docNo: string; isCash: boolean }> {
  assertCan(input.actor.role, 'expense.manage');
  const amount = Math.round(input.amountPaisa);
  if (amount <= 0) {throw new ValidationError('Amount must be greater than zero', 'amount');}
  if (!input.description.trim()) {throw new ValidationError('Description is required', 'description');}
  return db.tx(async tx => {
    const settings = await loadSettings(tx);
    const category = await tx.one<{ id: string }>('SELECT id FROM expense_categories WHERE id = ?', [
      input.categoryId,
    ]);
    if (!category) {throw new NotFoundError('Expense category', input.categoryId);}
    const method = await tx.one<{ is_cash: number; name_en: string }>(
      'SELECT is_cash, name_en FROM payment_methods WHERE id = ?',
      [input.methodId],
    );
    if (!method) {throw new NotFoundError('Payment method', input.methodId);}
    const at = input.spentAt ?? nowIso();
    const docNo = await nextDocNo(tx, { scope: 'expense', prefix: settings.expensePrefix, date: new Date(at) });
    const id = newId('exp');
    const isCash = Number(method.is_cash) === 1;
    await tx.exec(
      `INSERT INTO expenses (id, doc_no, category_id, description, amount_paisa, spent_at, method_id, payee,
          reference, notes, is_cash, status, client_ref, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
      [
        id,
        docNo,
        input.categoryId,
        input.description.trim(),
        amount,
        at,
        input.methodId,
        input.payee ?? null,
        input.reference ?? null,
        input.notes ?? null,
        isCash ? 1 : 0,
        input.clientRef ?? null,
        at,
        input.actor.name,
      ],
    );
    if (isCash) {
      const shift = await ensureShift(tx, input.actor);
      await postCashMovement(tx, {
        shiftId: shift.id,
        direction: 'out',
        amountPaisa: amount,
        sourceType: 'expense',
        sourceId: id,
        description: `Expense ${docNo}: ${input.description}`,
        actor: input.actor,
        at,
      });
    }
    await audit(tx, {
      actor: input.actor,
      action: 'expense.create',
      entity: 'expense',
      entityId: id,
      details: { docNo, amount, category: input.categoryId, cash: isCash },
    });
    return { id, docNo, isCash };
  });
}

export async function voidExpense(
  db: Database,
  input: { expenseId: string; reason: string; actor: Actor },
): Promise<void> {
  assertCan(input.actor.role, 'settings.manage');
  await db.tx(async tx => {
    const expense = await tx.one<{ id: string; doc_no: string; amount_paisa: number; is_cash: number; voided_at: string | null }>(
      'SELECT id, doc_no, amount_paisa, is_cash, voided_at FROM expenses WHERE id = ?',
      [input.expenseId],
    );
    if (!expense) {throw new NotFoundError('Expense', input.expenseId);}
    if (expense.voided_at) {throw new ValidationError('Expense is already voided');}
    const at = nowIso();
    await tx.exec(`UPDATE expenses SET status = 'void', voided_at = ?, void_reason = ? WHERE id = ?`, [
      at,
      input.reason,
      expense.id,
    ]);
    if (Number(expense.is_cash) === 1) {
      const shift = await ensureShift(tx, input.actor);
      await postCashMovement(tx, {
        shiftId: shift.id,
        direction: 'in',
        amountPaisa: Number(expense.amount_paisa),
        sourceType: 'adjustment',
        sourceId: expense.id,
        description: `Voided expense ${expense.doc_no}`,
        actor: input.actor,
      });
    }
    await audit(tx, {
      actor: input.actor,
      action: 'expense.void',
      entity: 'expense',
      entityId: expense.id,
      details: { reason: input.reason },
    });
  });
}

export interface ExpenseListQuery {
  from?: string;
  to?: string;
  categoryId?: string;
  limit?: number;
  beforeSpentAt?: string;
  beforeId?: string;
}

export async function listExpenses(db: Database, q: ExpenseListQuery = {}) {
  const limit = Math.min(q.limit ?? 40, 200);
  const where: string[] = ["e.status = 'posted'"];
  const params: (string | number)[] = [];
  if (q.from) {where.push('e.spent_at >= ?'); params.push(q.from);}
  if (q.to) {where.push('e.spent_at <= ?'); params.push(q.to);}
  if (q.categoryId) {where.push('e.category_id = ?'); params.push(q.categoryId);}
  if (q.beforeSpentAt) {
    where.push('(e.spent_at < ? OR (e.spent_at = ? AND e.id < ?))');
    params.push(q.beforeSpentAt, q.beforeSpentAt, q.beforeId ?? '');
  }
  params.push(limit);
  return db.query(
    `SELECT e.*, c.name_en AS category_name, m.name_en AS method_name
     FROM expenses e
     JOIN expense_categories c ON c.id = e.category_id
     JOIN payment_methods m ON m.id = e.method_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.spent_at DESC, e.id DESC LIMIT ?`,
    params,
  );
}

export async function expenseCategories(db: Database) {
  return db.query('SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name_en');
}

export async function createExpenseCategory(
  db: Database,
  input: { nameEn: string; nameUr: string },
  actor: Actor,
): Promise<string> {
  assertCan(actor.role, 'expense.manage');
  if (!input.nameEn.trim()) {throw new ValidationError('Category name is required');}
  const id = newId('expc');
  await db.tx(async tx => {
    await tx.exec('INSERT INTO expense_categories (id, name_en, name_ur, is_active) VALUES (?, ?, ?, 1)', [
      id,
      input.nameEn.trim(),
      input.nameUr.trim() || input.nameEn.trim(),
    ]);
    await audit(tx, { actor, action: 'expense.category.create', entity: 'expense_category', entityId: id });
  });
  return id;
}

export async function isCashPaymentMethod(db: Database, methodId: string): Promise<boolean> {
  return db.tx(tx => isCashMethod(tx, methodId));
}

export async function expenseTotals(db: Database, from: string, to: string) {
  const row = await db.one<{ total: number; cash: number; count: number }>(
    `SELECT COALESCE(SUM(amount_paisa),0) AS total,
            COALESCE(SUM(CASE WHEN is_cash = 1 THEN amount_paisa ELSE 0 END),0) AS cash,
            COUNT(*) AS count
     FROM expenses WHERE status = 'posted' AND spent_at >= ? AND spent_at <= ?`,
    [from, to],
  );
  return { totalPaisa: Number(row?.total ?? 0), cashPaisa: Number(row?.cash ?? 0), count: Number(row?.count ?? 0) };
}
