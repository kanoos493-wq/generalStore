/**
 * Ledger sign conventions (documented in ACCOUNTING_RULES.md).
 *
 * Each party ledger entry is stored with debit_paisa / credit_paisa and the
 * resulting running `balance_paisa` from the STORE's point of view:
 *
 *  Customers (receivables)
 *    debit  -> receivable increases (credit sale, opening receivable, +adjustment)
 *    credit -> receivable decreases (payment received, return/credit note, -adjustment)
 *    balance > 0  = customer owes the store
 *
 *  Suppliers (payables)
 *    credit -> payable increases (credit purchase, opening payable, +adjustment)
 *    debit  -> payable decreases (payment made, purchase return, -adjustment)
 *    balance > 0  = store owes the supplier
 */
import { mulDivRound, ratioBp } from './money';

export type PartyType = 'customer' | 'supplier';
export type LedgerSide = 'debit' | 'credit';

export interface LedgerEntryInput {
  at: string;
  docType: string;
  docId: string;
  description: string;
  debitPaisa?: number;
  creditPaisa?: number;
}

export interface LedgerEntry extends LedgerEntryInput {
  id: string;
  partyType: PartyType;
  partyId: string;
  debitPaisa: number;
  creditPaisa: number;
  balancePaisa: number;
}

/** Signed change to the party balance introduced by one entry. */
export function entryDelta(partyType: PartyType, debitPaisa: number, creditPaisa: number): number {
  return partyType === 'customer' ? debitPaisa - creditPaisa : creditPaisa - debitPaisa;
}

/**
 * Build a running statement. `openingBalancePaisa` uses the same sign
 * convention as balances (positive = owed by customer / owed to supplier).
 */
export function buildStatement(
  partyType: PartyType,
  openingBalancePaisa: number,
  entries: LedgerEntryInput[],
): { entries: LedgerEntry[]; closingBalancePaisa: number } {
  let balance = openingBalancePaisa;
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    const debit = Math.round(e.debitPaisa ?? 0);
    const credit = Math.round(e.creditPaisa ?? 0);
    balance += entryDelta(partyType, debit, credit);
    out.push({
      ...e,
      id: '',
      partyType,
      partyId: '',
      debitPaisa: debit,
      creditPaisa: credit,
      balancePaisa: balance,
    });
  }
  return { entries: out, closingBalancePaisa: balance };
}

/** Ageing buckets for receivables / payables. */
export interface AgeingBucket {
  label: 'current' | '1_30' | '31_60' | '61_plus';
  amountPaisa: number;
}

export function ageInDays(dueIso: string, asOf: Date): number {
  const due = new Date(dueIso).getTime();
  return Math.max(0, Math.floor((asOf.getTime() - due) / 86400000));
}

export function bucketForAge(days: number): AgeingBucket['label'] {
  if (days <= 0) {return 'current';}
  if (days <= 30) {return '1_30';}
  if (days <= 60) {return '31_60';}
  return '61_plus';
}

export function creditLimitUsageBp(balancePaisa: number, limitPaisa: number): number {
  if (limitPaisa <= 0) {return 0;}
  return ratioBp(balancePaisa, limitPaisa);
}

/** Validate that a payment does not exceed the outstanding balance. */
export function isOverpayment(amountPaisa: number, balancePaisa: number): boolean {
  return Math.round(amountPaisa) > Math.max(balancePaisa, 0);
}

/** Proportional discount allocation so line totals always add up exactly. */
export function allocateProportionally(totalPaisa: number, weightsPaisa: number[]): number[] {
  const sum = weightsPaisa.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return weightsPaisa.map(() => 0);
  }
  const raw = weightsPaisa.map(w => mulDivRound(totalPaisa, w, sum));
  const diff = totalPaisa - raw.reduce((a, b) => a + b, 0);
  if (diff !== 0 && raw.length > 0) {
    let idx = 0;
    for (let i = 1; i < weightsPaisa.length; i += 1) {
      if (weightsPaisa[i] > weightsPaisa[idx]) {idx = i;}
    }
    raw[idx] += diff;
  }
  return raw;
}
