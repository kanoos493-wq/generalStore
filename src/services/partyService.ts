/** Customers and suppliers: profiles, balances, statements. */
import type { Database, Tx } from '../db/database';
import type { PartyRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import type { PartyType } from '../core/ledger';
import { likePattern, normalizeSearch } from '../core/text';
import { audit } from './auditService';
import { postLedger } from './ledgerService';

const TABLE: Record<PartyType, string> = { customer: 'customers', supplier: 'suppliers' };

export interface PartyInput {
  nameEn: string;
  nameUr?: string | null;
  code?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  openingBalancePaisa?: number;
  creditLimitPaisa?: number;
  creditDays?: number;
  notes?: string | null;
  isActive?: boolean;
}

export async function createParty(
  db: Database,
  partyType: PartyType,
  input: PartyInput,
  actor: Actor,
): Promise<string> {
  assertCan(actor.role, partyType === 'customer' ? 'sale.create' : 'purchase.manage');
  if (!input.nameEn.trim()) {throw new ValidationError('Name is required', 'nameEn');}
  return db.tx(async tx => {
    const table = TABLE[partyType];
    const id = newId(partyType === 'customer' ? 'cust' : 'sup');
    const at = nowIso();
    const opening = Math.round(input.openingBalancePaisa ?? 0);
    const blob = normalizeSearch(input.nameEn, input.nameUr, input.phone, input.code);
    if (partyType === 'customer') {
      await tx.exec(
        `INSERT INTO customers (id, code, name_en, name_ur, phone, whatsapp, address, opening_balance_paisa,
            credit_limit_paisa, credit_days, notes, is_active, balance_paisa, search_blob, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          id,
          input.code ?? null,
          input.nameEn.trim(),
          input.nameUr ?? null,
          input.phone ?? null,
          input.whatsapp ?? null,
          input.address ?? null,
          opening,
          Math.round(input.creditLimitPaisa ?? 0),
          Math.round(input.creditDays ?? 0),
          input.notes ?? null,
          input.isActive === false ? 0 : 1,
          blob,
          at,
          at,
        ],
      );
    } else {
      await tx.exec(
        `INSERT INTO suppliers (id, code, name_en, name_ur, phone, whatsapp, address, contact_person,
            opening_balance_paisa, credit_days, notes, is_active, balance_paisa, search_blob, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          id,
          input.code ?? null,
          input.nameEn.trim(),
          input.nameUr ?? null,
          input.phone ?? null,
          input.whatsapp ?? null,
          input.address ?? null,
          input.contactPerson ?? null,
          opening,
          Math.round(input.creditDays ?? 0),
          input.notes ?? null,
          input.isActive === false ? 0 : 1,
          blob,
          at,
          at,
        ],
      );
    }
    if (opening !== 0) {
      await postLedger(tx, {
        partyType,
        partyId: id,
        at,
        docType: 'opening',
        docId: id,
        description: 'Opening balance',
        debitPaisa: partyType === 'customer' ? opening : 0,
        creditPaisa: partyType === 'supplier' ? opening : 0,
        actorName: actor.name,
      });
    }
    await audit(tx, { actor, action: `${partyType}.create`, entity: partyType, entityId: id, details: { name: input.nameEn } });
    void table;
    return id;
  });
}

export async function updateParty(
  db: Database,
  partyType: PartyType,
  input: PartyInput & { id: string },
  actor: Actor,
): Promise<void> {
  assertCan(actor.role, partyType === 'customer' ? 'sale.create' : 'purchase.manage');
  await db.tx(async tx => {
    const table = TABLE[partyType];
    const existing = await tx.one<PartyRow>(`SELECT * FROM ${table} WHERE id = ?`, [input.id]);
    if (!existing) {throw new NotFoundError(partyType, input.id);}
    const at = nowIso();
    const blob = normalizeSearch(input.nameEn, input.nameUr, input.phone, input.code);
    if (partyType === 'customer') {
      await tx.exec(
        `UPDATE customers SET code = ?, name_en = ?, name_ur = ?, phone = ?, whatsapp = ?, address = ?,
           credit_limit_paisa = ?, credit_days = ?, notes = ?, is_active = ?, search_blob = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.code ?? existing.code,
          input.nameEn.trim(),
          input.nameUr ?? null,
          input.phone ?? null,
          input.whatsapp ?? null,
          input.address ?? null,
          Math.round(input.creditLimitPaisa ?? 0),
          Math.round(input.creditDays ?? 0),
          input.notes ?? null,
          input.isActive === false ? 0 : 1,
          blob,
          at,
          input.id,
        ],
      );
    } else {
      await tx.exec(
        `UPDATE suppliers SET code = ?, name_en = ?, name_ur = ?, phone = ?, whatsapp = ?, address = ?,
           contact_person = ?, credit_days = ?, notes = ?, is_active = ?, search_blob = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.code ?? existing.code,
          input.nameEn.trim(),
          input.nameUr ?? null,
          input.phone ?? null,
          input.whatsapp ?? null,
          input.address ?? null,
          input.contactPerson ?? null,
          Math.round(input.creditDays ?? 0),
          input.notes ?? null,
          input.isActive === false ? 0 : 1,
          blob,
          at,
          input.id,
        ],
      );
    }
    await audit(tx, { actor, action: `${partyType}.update`, entity: partyType, entityId: input.id });
    void table;
  });
}

export interface PartyListQuery {
  query?: string;
  onlyWithBalance?: boolean;
  includeInactive?: boolean;
  limit?: number;
  cursor?: { after: string; afterId: string } | null;
}

export async function listParties(db: Database, partyType: PartyType, q: PartyListQuery = {}) {
  const limit = Math.min(q.limit ?? 40, 200);
  const table = TABLE[partyType];
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!q.includeInactive) {where.push('is_active = 1');}
  if (q.onlyWithBalance) {where.push('balance_paisa <> 0');}
  if (q.query && q.query.trim()) {
    where.push(`search_blob LIKE ? ESCAPE '\\'`);
    params.push(likePattern(normalizeSearch(q.query)));
  }
  if (q.cursor) {
    where.push('(name_en > ? OR (name_en = ? AND id > ?))');
    params.push(q.cursor.after, q.cursor.after, q.cursor.afterId);
  }
  params.push(limit);
  const rows = await db.query(
    `SELECT * FROM ${table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY name_en ASC, id ASC LIMIT ?`,
    params,
  );
  return rows as unknown as PartyRow[];
}

export function partyCursor(rows: PartyRow[]) {
  if (!rows.length) {return null;}
  const last = rows[rows.length - 1];
  return { after: last.name_en, afterId: last.id };
}

export async function partyDetail(db: Database, partyType: PartyType, id: string) {
  const table = TABLE[partyType];
  const party = await db.one<PartyRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!party) {throw new NotFoundError(partyType, id);}
  const ledger = await db.query(
    'SELECT * FROM ledger_entries WHERE party_type = ? AND party_id = ? ORDER BY entry_at DESC, id DESC LIMIT 60',
    [partyType, id],
  );
  const payments = await db.query(
    'SELECT * FROM payments WHERE party_type = ? AND party_id = ? ORDER BY paid_at DESC LIMIT 30',
    [partyType, id],
  );
  const docs =
    partyType === 'customer'
      ? await db.query('SELECT * FROM sales WHERE customer_id = ? ORDER BY sold_at DESC LIMIT 30', [id])
      : await db.query('SELECT * FROM purchases WHERE supplier_id = ? ORDER BY purchased_at DESC LIMIT 30', [id]);
  const totals = await db.one<{ total: number; count: number }>(
    partyType === 'customer'
      ? `SELECT COALESCE(SUM(total_paisa),0) AS total, COUNT(*) AS count FROM sales WHERE customer_id = ? AND status = 'posted'`
      : `SELECT COALESCE(SUM(total_paisa),0) AS total, COUNT(*) AS count FROM purchases WHERE supplier_id = ? AND status = 'posted'`,
    [id],
  );
  return { party, ledger, payments, docs, totals };
}

/** Statement: opening balance before `from`, entries in range, closing balance. */
export async function partyStatement(
  db: Database,
  partyType: PartyType,
  id: string,
  range: { from: string; to: string },
) {
  const party = await db.one<PartyRow>(`SELECT * FROM ${TABLE[partyType]} WHERE id = ?`, [id]);
  if (!party) {throw new NotFoundError(partyType, id);}
  const before = await db.one<{ balance: number | null }>(
    `SELECT balance_paisa AS balance FROM ledger_entries
     WHERE party_type = ? AND party_id = ? AND entry_at < ?
     ORDER BY entry_at DESC, id DESC LIMIT 1`,
    [partyType, id, range.from],
  );
  const opening = Number(before?.balance ?? 0);
  const entries = await db.query(
    `SELECT * FROM ledger_entries WHERE party_type = ? AND party_id = ? AND entry_at >= ? AND entry_at <= ?
     ORDER BY entry_at ASC, id ASC`,
    [partyType, id, range.from, range.to],
  );
  const closing = entries.length ? Number(entries[entries.length - 1].balance_paisa) : opening;
  return { party, openingBalancePaisa: opening, entries, closingBalancePaisa: closing };
}

export async function partiesWithDues(db: Database, partyType: PartyType, limit = 50) {
  return db.query(
    `SELECT * FROM ${TABLE[partyType]} WHERE balance_paisa > 0 AND is_active = 1 ORDER BY balance_paisa DESC LIMIT ?`,
    [limit],
  );
}

export async function partyCount(tx: Tx, partyType: PartyType): Promise<number> {
  const row = await tx.one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${TABLE[partyType]}`);
  return Number(row?.c ?? 0);
}
