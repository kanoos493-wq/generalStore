/** Typed, defensive access to the `settings` key/value table. */
import type { PriceRounding } from '../core/pricing';
import { DEFAULT_SETTINGS } from '../db/seed';
import type { Database, Tx } from '../db/database';

export type Language = 'en' | 'ur';

export class StoreSettings {
  constructor(private readonly map: Record<string, string>) {}

  private raw(key: string): string {
    return this.map[key] ?? DEFAULT_SETTINGS[key] ?? '';
  }

  private int(key: string, fallback = 0): number {
    const v = parseInt(this.raw(key), 10);
    return Number.isFinite(v) ? v : fallback;
  }

  private bool(key: string, fallback = false): boolean {
    const raw = this.raw(key);
    if (raw === '') {return fallback;}
    return raw === '1' || raw === 'true';
  }

  get storeName(): string {return this.raw('store_name');}
  get storeNameUr(): string {return this.raw('store_name_ur');}
  get address(): string {return this.raw('store_address');}
  get phone(): string {return this.raw('store_phone');}
  get whatsapp(): string {return this.raw('store_whatsapp');}
  get language(): Language {return this.raw('language') === 'ur' ? 'ur' : 'en';}
  get currency(): string {return this.raw('currency') || 'PKR';}
  get priceRounding(): PriceRounding {
    const v = this.raw('price_rounding');
    return v === 'rupee' || v === 'five_rupees' ? v : 'paisa';
  }
  get qtyPrecision(): number {return Math.min(6, Math.max(0, this.int('qty_precision', 3)));}
  get valuationMethod(): 'wac' | 'latest' {
    return this.raw('valuation_method') === 'latest' ? 'latest' : 'wac';
  }
  get allowNegativeStock(): boolean {return this.bool('allow_negative_stock');}
  get discountLimitBp(): number {return this.int('discount_limit_bp', 2000);}
  get taxEnabled(): boolean {return this.bool('tax_enabled');}
  get defaultTaxBp(): number {return this.int('default_tax_bp', 0);}
  get invoicePrefix(): string {return this.raw('invoice_prefix') || 'INV';}
  get purchasePrefix(): string {return this.raw('purchase_prefix') || 'PUR';}
  get adjustmentPrefix(): string {return this.raw('adjustment_prefix') || 'ADJ';}
  get returnPrefix(): string {return this.raw('return_prefix') || 'RET';}
  get expensePrefix(): string {return this.raw('expense_prefix') || 'EXP';}
  get receiptFooter(): string {return this.raw('receipt_footer');}
  get receiptTerms(): string {return this.raw('receipt_terms');}
  get returnPolicy(): string {return this.raw('return_policy');}
  get receiptFontSize(): number {return Math.min(20, Math.max(7, this.int('receipt_font_size', 10)));}
  get receiptLanguage(): Language {return this.raw('receipt_language') === 'ur' ? 'ur' : 'en';}
  get autoLockTimeout(): string {return this.raw('auto_lock_timeout') || '1min';}
  get pinEnabled(): boolean {return this.bool('pin_enabled', true);}
  get backupReminderDays(): number {return this.int('backup_reminder_days', 7);}
  get showUrduNames(): boolean {return this.bool('show_urdu_names', true);}
  get operatorName(): string {return this.raw('operator_name') || 'Owner';}

  toMap(): Record<string, string> {
    return { ...this.map };
  }
}

export async function loadSettings(db: Database | Tx): Promise<StoreSettings> {
  const rows = await db.query('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[String(row.key)] = String(row.value ?? '');
  }
  return new StoreSettings(map);
}

export async function setSettings(tx: Tx, values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await tx.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
}
