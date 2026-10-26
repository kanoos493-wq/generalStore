/**
 * Exact money and quantity arithmetic.
 *
 * Representation (documented in DATABASE_DESIGN.md and ACCOUNTING_RULES.md):
 *  - Money is stored as an integer number of paisa (1 PKR = 100 paisa).
 *  - Quantity is stored as an integer number of "micro base units"
 *    (1 base unit = 1_000_000 micro units), e.g. 500 g = 0.5 kg = 500000 micro.
 *
 * No binary floating point is used for financial or quantity math: every
 * multiplication / division goes through BigInt and rounds half up (away from
 * zero) back into the integer domain.
 */

export const MONEY_SCALE = 100; // paisa per rupee
export const QTY_SCALE = 1_000_000; // micro units per base unit
export const MONEY_DECIMALS = 2;
export const QTY_DECIMALS = 6;
export const DEFAULT_QTY_PRECISION = 3;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function big(n: number): bigint {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Expected a finite number, received ${String(n)}`);
  }
  return BigInt(Math.round(n));
}

/** Divide two bigints, rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) {throw new Error('Division by zero');}
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return negative ? -q : q;
}

function safeBigToNumber(v: bigint): number {
  if (v > BigInt(MAX_SAFE) || v < BigInt(-MAX_SAFE)) {
    throw new Error('Numeric overflow: value exceeds safe integer range');
  }
  return Number(v);
}

/** (value * mul) / div, exact, rounded half up, returned as a safe integer. */
export function mulDivRound(value: number, mul: number, div: number): number {
  return safeBigToNumber(divRound(big(value) * big(mul), big(div)));
}

/** (a * b) / c guard used by all price/quantity math. */
export function mulRatio(a: number, b: number, c: number): number {
  return mulDivRound(a, b, c);
}

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.', '٬': '', ',': '', ' ': '', '\u00a0': '', '\u200f': '', '\u200e': '',
};

function normalizeNumericText(input: string): string {
  let out = '';
  for (const ch of input.trim()) {
    out += DIGIT_MAP[ch] ?? ch;
  }
  // strip currency markers and thousand separators that survived
  out = out.replace(/rs\.?/gi, '').replace(/pkr/gi, '').replace(/₨/g, '');
  return out.replace(/\s+/g, '');
}

function parseScaled(input: string | number, decimals: number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {return null;}
    const scaled = Math.round(input * Math.pow(10, decimals));
    if (!Number.isSafeInteger(scaled)) {return null;}
    return scaled;
  }
  const text = normalizeNumericText(input);
  if (text === '' || text === '-' || text === '.') {return null;}
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) {return null;}
  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] ?? '';
  const fracRaw = match[3] ?? '';
  if (whole === '' && fracRaw === '') {return null;}
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const value = Number(`${whole === '' ? '0' : whole}${frac}`);
  if (!Number.isSafeInteger(value)) {return null;}
  return sign * value;
}

/** Parse user-typed money ("1,200.50", "1200", "Rs 12.5") into paisa. */
export function parseMoney(input: string | number): number {
  const v = parseScaled(input, MONEY_DECIMALS);
  if (v === null) {throw new Error(`Invalid amount: ${String(input)}`);}
  return v;
}

/** Parse user-typed money, returning null instead of throwing. */
export function tryParseMoney(input: string | number): number | null {
  return parseScaled(input, MONEY_DECIMALS);
}

/** Parse a user-typed quantity ("0.5", "1.25", "500") into micro base units. */
export function parseQty(input: string | number): number {
  const v = parseScaled(input, QTY_DECIMALS);
  if (v === null) {throw new Error(`Invalid quantity: ${String(input)}`);}
  return v;
}

export function tryParseQty(input: string | number): number | null {
  return parseScaled(input, QTY_DECIMALS);
}

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format paisa as a plain decimal string, e.g. 120050 -> "1,200.50". */
export function formatMoney(paisa: number, opts: { decimals?: number; grouping?: boolean } = {}): string {
  const decimals = opts.decimals ?? MONEY_DECIMALS;
  const negative = paisa < 0;
  let abs = Math.abs(Math.round(paisa));
  if (decimals <= 0) {
    const whole = Math.round(abs / MONEY_SCALE).toString();
    return `${negative ? '-' : ''}${opts.grouping === false ? whole : groupDigits(whole)}`;
  }
  const whole = Math.floor(abs / MONEY_SCALE).toString();
  const frac = (abs % MONEY_SCALE).toString().padStart(2, '0').slice(0, decimals);
  return `${negative ? '-' : ''}${opts.grouping === false ? whole : groupDigits(whole)}.${frac}`;
}

/** Format paisa without grouping, suitable for CSV/Excel. */
export function moneyToCsv(paisa: number): string {
  return formatMoney(paisa, { grouping: false });
}

/** Format micro quantity, trimming trailing zeros up to `precision` decimals. */
export function formatQty(micro: number, precision = DEFAULT_QTY_PRECISION): string {
  const negative = micro < 0;
  const abs = Math.abs(Math.round(micro));
  const whole = Math.floor(abs / QTY_SCALE);
  const fracFull = (abs % QTY_SCALE).toString().padStart(QTY_DECIMALS, '0');
  let frac = fracFull.slice(0, Math.max(0, precision));
  frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Quantity as a CSV friendly decimal string with up to 6 decimals. */
export function qtyToCsv(micro: number): string {
  return formatQty(micro, 6);
}

/** Round an amount to a step (in paisa). step <= 1 means no rounding. */
export function roundToStep(paisa: number, stepPaisa: number): number {
  if (!stepPaisa || stepPaisa <= 1) {return Math.round(paisa);}
  return mulDivRound(paisa, 1, stepPaisa) * stepPaisa;
}

/** Basis points of an amount (1 bp = 0.01%), rounded half up. */
export function bpOf(amountPaisa: number, bp: number): number {
  return mulDivRound(amountPaisa, bp, 10000);
}

/** Percentage (as a decimal fraction string already parsed to bp) helper. */
export function percentOf(amountPaisa: number, percent: number): number {
  return mulDivRound(amountPaisa, Math.round(percent * 100), 10000);
}

export function clampMoney(paisa: number, min = 0): number {
  return paisa < min ? min : Math.round(paisa);
}

export function sumMoney(values: number[]): number {
  let total = 0n;
  for (const v of values) {total += big(v);}
  return safeBigToNumber(total);
}

export function sumQty(values: number[]): number {
  let total = 0n;
  for (const v of values) {total += big(v);}
  return safeBigToNumber(total);
}

/** Ratio in basis points: (a/b)*10000 rounded. Returns 0 when b is 0. */
export function ratioBp(a: number, b: number): number {
  if (!b) {return 0;}
  return mulDivRound(a, 10000, b);
}
