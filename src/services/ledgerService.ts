/**
 * Party ledger engine (customers = receivables, suppliers = payables).
 * Balances are cached on the party row and appended to `ledger_entries` with a
 * running balance. Direct balance edits are impossible: every change is an
 * entry referencing a source document.
 */
import type { Tx } from '../db/database';
import type { PartyType } from '../core/ledger';
import { entryDelta } from '../core/ledger';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { NotFoundError } from '../core/errors';
import type { PartyRow } from '../db/types';

export interface LedgerPost {
  partyType: PartyType;
  partyId: string;
  debitPaisa?: number;
  creditPaisa?: number;
  at?: string;
  docType: string;
  docId?: string | null;
  description: string;
  actorName?: string | null;
}

const TABLE: Record<PartyType, string> = { customer: 'customers', supplier: 'suppliers' };

export async function partyBalance(tx: Tx, partyType: PartyType, partyId: string): Promise<number> {
  const row = await tx.one<{ balance_paisa: number }>(
    `SELECT balance_paisa FROM ${TABLE[partyType]} WHERE id = ?`,
    [partyId],
  );
  if (!row) {throw new NotFoundError(partyType, partyId);}
  return Number(row.balance_paisa);
}

export async function postLedger(tx: Tx, post: LedgerPost): Promise<number> {
  const debit = Math.round(post.debitPaisa ?? 0);
  const credit = Math.round(post.creditPaisa ?? 0);
  if (debit === 0 && credit === 0) {return partyBalance(tx, post.partyType, post.partyId);}
  if (debit < 0 || credit < 0) {throw new Error('Ledger amounts must be non-negative');}

  const at = post.at ?? nowIso();
  const current = await partyBalance(tx, post.partyType, post.partyId);
  const next = current + entryDelta(post.partyType, debit, credit);

  await tx.exec(`UPDATE ${TABLE[post.partyType]} SET balance_paisa = ?, updated_at = ? WHERE id = ?`, [
    next,
    at,
    post.partyId,
  ]);
  await tx.exec(
    `INSERT INTO ledger_entries (
       id, party_type, party_id, entry_at, doc_type, doc_id, description,
       debit_paisa, credit_paisa, balance_paisa, created_at, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('led'),
      post.partyType,
      post.partyId,
      at,
      post.docType,
      post.docId ?? null,
      post.description,
      debit,
      credit,
      next,
      at,
      post.actorName ?? null,
    ],
  );
  return next;
}

/** Fetch a party with its cached balance. */
export async function getParty(
  tx: Tx,
  partyType: PartyType,
  partyId: string,
): Promise<PartyRow & { credit_limit_paisa?: number }> {
  const row = await tx.one<PartyRow>(`SELECT * FROM ${TABLE[partyType]} WHERE id = ?`, [partyId]);
  if (!row) {throw new NotFoundError(partyType, partyId);}
  return row;
}

export async function ledgerEntries(
  tx: Tx,
  partyType: PartyType,
  partyId: string,
  limit = 200,
  beforeAt?: string,
) {
  const params: (string | number)[] = [partyType, partyId];
  let sql = `SELECT * FROM ledger_entries WHERE party_type = ? AND party_id = ?`;
  if (beforeAt) {
    sql += ' AND entry_at < ?';
    params.push(beforeAt);
  }
  sql += ' ORDER BY entry_at DESC, id DESC LIMIT ?';
  params.push(limit);
  return tx.query(sql, params);
}
