/**
 * Identifier generation. IDs are time-ordered and stable across exports /
 * restores. Not cryptographically secure — never used for secrets.
 */
let counter = 0;

export function newId(prefix?: string): string {
  counter = (counter + 1) % 0x100000;
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, '0');
  const seq = counter.toString(36).padStart(4, '0');
  const id = `${time}${seq}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}

/** Document numbers such as INV-20261026-0007 (sequence comes from the DB). */
export function formatDocNo(prefix: string, date: Date, sequence: number, width = 4): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${`${sequence}`.padStart(width, '0')}`;
}
