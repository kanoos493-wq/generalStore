/**
 * Receipt rendering. Produces plain text for 58 mm (32 cols) and 80 mm
 * (42 cols) thermal printers, so the layout is testable without a printer and
 * works with both the ESC/POS and Android print paths.
 */
import { formatMoney, formatQty } from '../core/money';
import { formatDateTime } from '../core/dates';
import type { SaleLineRow, SaleRow } from '../db/types';

export type PaperWidth = 58 | 80;
export type ReceiptLanguage = 'en' | 'ur' | 'both';

export interface ReceiptStore {
  nameEn: string;
  nameUr: string;
  address: string;
  phone: string;
  footer: string;
  terms: string;
  returnPolicy: string;
}

export interface ReceiptPayment {
  methodName: string;
  amountPaisa: number;
}

export interface ReceiptData {
  sale: SaleRow;
  lines: SaleLineRow[];
  payments: ReceiptPayment[];
  store: ReceiptStore;
  cashier?: string | null;
  previousBalancePaisa?: number;
  customerBalancePaisa?: number;
  duplicate?: boolean;
  language?: ReceiptLanguage;
  showUrduNames?: boolean;
}

export function columnsFor(width: PaperWidth): number {
  return width === 58 ? 32 : 42;
}

function center(text: string, width: number): string {
  if (text.length >= width) {return text.slice(0, width);}
  const pad = Math.floor((width - text.length) / 2);
  return `${' '.repeat(pad)}${text}`;
}

function twoCols(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  if (left.length >= width - 1) {
    return `${left.slice(0, width)}\n${twoCols('', right, width)}`;
  }
  return `${left}${' '.repeat(space)}${right}`.slice(0, width);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current.length) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {lines.push(current);}
  return lines.length ? lines : [''];
}

function rule(width: number, char = '-'): string {
  return char.repeat(width);
}

/** Receipt text, line by line, ready for a thermal printer. */
export function buildReceipt(data: ReceiptData, width: PaperWidth = 58): string {
  const w = columnsFor(width);
  const lang = data.language ?? 'en';
  const { sale, lines, store } = data;
  const out: string[] = [];

  if (data.duplicate) {
    out.push(center('*** DUPLICATE / REPRINT ***', w));
  }
  if (lang === 'en' || lang === 'both') {out.push(center(store.nameEn.toUpperCase(), w));}
  if ((lang === 'ur' || lang === 'both') && store.nameUr) {out.push(center(store.nameUr, w));}
  if (store.address) {wrap(store.address, w).forEach(l => out.push(center(l, w)));}
  if (store.phone) {out.push(center(`Tel: ${store.phone}`, w));}
  out.push(rule(w));

  out.push(twoCols(`Invoice: ${sale.invoice_no}`, '', w).trimEnd());
  out.push(formatDateTime(sale.sold_at));
  if (data.cashier) {out.push(`Cashier: ${data.cashier}`);}
  if (sale.customer_name) {out.push(`Customer: ${sale.customer_name}`);}
  out.push(rule(w));

  out.push(twoCols('Item', 'Amount', w));
  out.push(rule(w, '.'));
  for (const line of lines) {
    const name = `${line.product_name}`;
    for (const l of wrap(name, w)) {out.push(l);}
    const qty = `${formatQty(Number(line.qty_micro), 3)} ${line.unit_code}`;
    const rate = `@ ${formatMoney(Number(line.unit_price_paisa))}`;
    out.push(twoCols(`  ${qty} ${rate}`, formatMoney(Number(line.line_total_paisa)), w).trimEnd());
    if (Number(line.line_discount_paisa) > 0) {
      out.push(twoCols('  discount', `-${formatMoney(Number(line.line_discount_paisa))}`, w).trimEnd());
    }
  }
  out.push(rule(w));
  out.push(twoCols('Subtotal', formatMoney(Number(sale.subtotal_paisa)), w).trimEnd());
  if (Number(sale.discount_paisa) > 0) {
    out.push(twoCols('Discount', `-${formatMoney(Number(sale.discount_paisa))}`, w).trimEnd());
  }
  if (Number(sale.tax_paisa) > 0) {
    out.push(twoCols('Tax', formatMoney(Number(sale.tax_paisa)), w).trimEnd());
  }
  out.push(twoCols('TOTAL', formatMoney(Number(sale.total_paisa)), w).trimEnd());

  for (const p of data.payments) {
    out.push(twoCols(p.methodName, formatMoney(p.amountPaisa), w).trimEnd());
  }
  if (Number(sale.credit_paisa) > 0) {
    out.push(twoCols('On credit (khata)', formatMoney(Number(sale.credit_paisa)), w).trimEnd());
  }
  if (data.previousBalancePaisa !== undefined && data.previousBalancePaisa > 0) {
    out.push(rule(w));
    out.push(twoCols('Previous balance', formatMoney(data.previousBalancePaisa), w).trimEnd());
  }
  if (data.customerBalancePaisa !== undefined) {
    out.push(twoCols('Total due', formatMoney(data.customerBalancePaisa), w).trimEnd());
  }

  out.push(rule(w));
  if (store.footer) {wrap(store.footer, w).forEach(l => out.push(center(l, w)));}
  if (store.returnPolicy) {wrap(store.returnPolicy, w).forEach(l => out.push(center(l, w)));}
  if (store.terms) {
    out.push(rule(w, '.'));
    wrap(store.terms, w).forEach(l => out.push(l));
  }
  out.push('');
  out.push('');
  return out.join('\n');
}

/** Compact preview used in the app before printing. */
export function receiptPreviewText(text: string): string {
  return text.trimEnd();
}

export interface ReceiptTotalsCheck {
  ok: boolean;
  expectedTotalPaisa: number;
  actualTotalPaisa: number;
}

/** Sanity check so a printed bill always matches the stored invoice. */
export function checkReceipt(lines: SaleLineRow[], sale: SaleRow): ReceiptTotalsCheck {
  const lineNet = lines.reduce((acc, l) => acc + Number(l.line_total_paisa), 0);
  const lineDiscounts = lines.reduce((acc, l) => acc + Number(l.line_discount_paisa), 0);
  // sale.discount_paisa holds line + cart discounts; line discounts are already
  // excluded from line_total_paisa, so only the cart part is subtracted here.
  const cartDiscount = Number(sale.discount_paisa) - lineDiscounts;
  const expected = lineNet - cartDiscount + Number(sale.tax_paisa);
  return {
    ok: expected === Number(sale.total_paisa),
    expectedTotalPaisa: expected,
    actualTotalPaisa: Number(sale.total_paisa),
  };
}
