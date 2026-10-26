/**
 * Cash drawer ledger and shift closing.
 *
 * expected closing cash = opening cash + cash inflows - cash outflows
 * Digital payments never touch this ledger (spec requirement).
 */
import type { Database, Tx } from '../db/database';
import type { ShiftRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { audit } from './auditService';
import { loadSettings } from './settingsService';

export async function isCashMethod(tx: Tx, methodId: string): Promise<boolean> {
  const row = await tx.one<{ is_cash: number }>('SELECT is_cash FROM payment_methods WHERE id = ?', [
    methodId,
  ]);
  return Number(row?.is_cash ?? 0) === 1;
}

export async function getOpenShift(tx: Tx): Promise<ShiftRow | undefined> {
  return tx.one<ShiftRow>(`SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`);
}

/** Returns the open shift, opening one automatically with the last counted cash. */
export async function ensureShift(tx: Tx, actor: Actor): Promise<ShiftRow> {
  const open = await getOpenShift(tx);
  if (open) {return open;}
  const last = await tx.one<{ counted_cash_paisa: number | null }>(
    `SELECT counted_cash_paisa FROM shifts WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
  );
  const opening = Number(last?.counted_cash_paisa ?? 0);
  const shift: ShiftRow = {
    id: newId('shift'),
    opened_at: nowIso(),
    closed_at: null,
    opening_cash_paisa: opening,
    expected_cash_paisa: 0,
    counted_cash_paisa: null,
    difference_paisa: null,
    status: 'open',
    notes: null,
    opened_by: actor.name,
    closed_by: null,
  };
  await tx.exec(
    `INSERT INTO shifts (id, opened_at, opening_cash_paisa, status, opened_by)
     VALUES (?, ?, ?, 'open', ?)`,
    [shift.id, shift.opened_at, opening, actor.name],
  );
  return shift;
}

export type CashSource =
  | 'sale'
  | 'sale_refund'
  | 'customer_payment'
  | 'supplier_payment'
  | 'purchase'
  | 'expense'
  | 'owner_deposit'
  | 'owner_withdrawal'
  | 'adjustment';

export interface CashMovementInput {
  shiftId: string;
  direction: 'in' | 'out';
  amountPaisa: number;
  sourceType: CashSource;
  sourceId?: string | null;
  description: string;
  actor: Actor;
  at?: string;
}

export async function postCashMovement(tx: Tx, input: CashMovementInput): Promise<string> {
  const amount = Math.round(input.amountPaisa);
  if (amount <= 0) {throw new ValidationError('Cash amount must be greater than zero');}
  const id = newId('cash');
  const at = input.at ?? nowIso();
  await tx.exec(
    `INSERT INTO cash_movements (id, shift_id, moved_at, direction, amount_paisa, source_type, source_id, description, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.shiftId,
      at,
      input.direction,
      amount,
      input.sourceType,
      input.sourceId ?? null,
      input.description,
      at,
      input.actor.name,
    ],
  );
  return id;
}

export interface CashSummary {
  openingPaisa: number;
  inflowPaisa: number;
  outflowPaisa: number;
  expectedPaisa: number;
}

export async function cashSummary(tx: Tx, shiftId: string): Promise<CashSummary> {
  const shift = await tx.one<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shift) {throw new ValidationError('Shift not found');}
  const row = await tx.one<{ inflow: number; outflow: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_paisa ELSE 0 END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_paisa ELSE 0 END), 0) AS outflow
     FROM cash_movements WHERE shift_id = ?`,
    [shiftId],
  );
  const inflow = Number(row?.inflow ?? 0);
  const outflow = Number(row?.outflow ?? 0);
  return {
    openingPaisa: Number(shift.opening_cash_paisa),
    inflowPaisa: inflow,
    outflowPaisa: outflow,
    expectedPaisa: Number(shift.opening_cash_paisa) + inflow - outflow,
  };
}

export async function openShift(
  db: Database,
  input: { openingCashPaisa: number; actor: Actor; notes?: string },
): Promise<ShiftRow> {
  assertCan(input.actor.role, 'cash.close');
  const amount = Math.round(input.openingCashPaisa);
  if (amount < 0) {throw new ValidationError('Opening cash cannot be negative');}
  return db.tx(async tx => {
    const open = await getOpenShift(tx);
    if (open) {throw new ValidationError('A shift is already open. Close it first.');}
    const id = newId('shift');
    const at = nowIso();
    await tx.exec(
      `INSERT INTO shifts (id, opened_at, opening_cash_paisa, status, notes, opened_by)
       VALUES (?, ?, ?, 'open', ?, ?)`,
      [id, at, amount, input.notes ?? null, input.actor.name],
    );
    await audit(tx, { actor: input.actor, action: 'shift.open', entity: 'shift', entityId: id, details: { amount } });
    return (await tx.one<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [id]))!;
  });
}

export interface CloseShiftResult {
  shiftId: string;
  summary: CashSummary;
  countedPaisa: number;
  differencePaisa: number;
}

export async function closeShift(
  db: Database,
  input: { countedPaisa: number; notes?: string; actor: Actor; shiftId?: string },
): Promise<CloseShiftResult> {
  assertCan(input.actor.role, 'cash.close');
  const counted = Math.round(input.countedPaisa);
  if (counted < 0) {throw new ValidationError('Counted cash cannot be negative');}
  return db.tx(async tx => {
    const shift = input.shiftId
      ? await tx.one<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [input.shiftId])
      : await getOpenShift(tx);
    if (!shift) {throw new ValidationError('No open shift to close');}
    if (shift.status === 'closed') {throw new ValidationError('Shift is already closed');}
    const summary = await cashSummary(tx, shift.id);
    const difference = counted - summary.expectedPaisa;
    const at = nowIso();
    await tx.exec(
      `UPDATE shifts SET status = 'closed', closed_at = ?, expected_cash_paisa = ?, counted_cash_paisa = ?,
         difference_paisa = ?, notes = COALESCE(?, notes), closed_by = ? WHERE id = ?`,
      [at, summary.expectedPaisa, counted, difference, input.notes ?? null, input.actor.name, shift.id],
    );
    await audit(tx, {
      actor: input.actor,
      action: 'shift.close',
      entity: 'shift',
      entityId: shift.id,
      details: { counted, expected: summary.expectedPaisa, difference },
    });
    return { shiftId: shift.id, summary, countedPaisa: counted, differencePaisa: difference };
  });
}

export async function manualCashMovement(
  db: Database,
  input: {
    direction: 'in' | 'out';
    amountPaisa: number;
    description: string;
    actor: Actor;
  },
): Promise<string> {
  assertCan(input.actor.role, 'cash.close');
  return db.tx(async tx => {
    const shift = await ensureShift(tx, input.actor);
    const id = await postCashMovement(tx, {
      shiftId: shift.id,
      direction: input.direction,
      amountPaisa: input.amountPaisa,
      sourceType: input.direction === 'in' ? 'owner_deposit' : 'owner_withdrawal',
      description: input.description,
      actor: input.actor,
    });
    await audit(tx, {
      actor: input.actor,
      action: 'cash.manual',
      entity: 'cash_movement',
      entityId: id,
      details: input,
    });
    return id;
  });
}

export async function shiftHistory(db: Database, limit = 30): Promise<(ShiftRow & { sales_count: number })[]> {
  const rows = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM sales sa WHERE sa.shift_id = s.id AND sa.status = 'posted') AS sales_count
     FROM shifts s ORDER BY s.opened_at DESC LIMIT ?`,
    [limit],
  );
  return rows as unknown as (ShiftRow & { sales_count: number })[];
}

export async function cashMovementsForShift(db: Database, shiftId: string) {
  return db.query('SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY moved_at DESC, id DESC', [
    shiftId,
  ]);
}

export async function currentShiftSummary(db: Database): Promise<CashSummary & { shiftId: string | null }> {
  const settings = await loadSettings(db);
  void settings;
  const row = await db.one<ShiftRow>(`SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`);
  if (!row) {
    return { shiftId: null, openingPaisa: 0, inflowPaisa: 0, outflowPaisa: 0, expectedPaisa: 0 };
  }
  const summary = await db.tx(tx => cashSummary(tx, row.id));
  return { shiftId: row.id, ...summary };
}
