/**
 * Transaction-safe document numbers.
 * The sequence row is read and bumped inside the caller's transaction, so two
 * concurrent checkouts can never produce the same number.
 */
import type { Tx } from '../db/database';
import { formatDocNo } from '../core/ids';
import { toDateKey } from '../core/dates';

export async function nextDocNo(
  tx: Tx,
  opts: { scope: string; prefix: string; date?: Date },
): Promise<string> {
  const date = opts.date ?? new Date();
  const key = `${opts.scope}:${toDateKey(date)}`;
  const row = await tx.one<{ next_value: number }>(
    'SELECT next_value FROM sequences WHERE key = ?',
    [key],
  );
  const next = row ? Number(row.next_value) : 1;
  if (row) {
    await tx.exec('UPDATE sequences SET next_value = ? WHERE key = ?', [next + 1, key]);
  } else {
    await tx.exec('INSERT INTO sequences (key, next_value) VALUES (?, ?)', [key, next + 1]);
  }
  return formatDocNo(opts.prefix, date, next);
}
