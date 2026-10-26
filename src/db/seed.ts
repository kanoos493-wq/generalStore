/** Default seed data: units, payment methods, expense categories, settings. */
import { BUILTIN_UNITS } from '../core/units';
import type { SqlExecutor } from './driver';
import { nowIso } from '../core/dates';

export const WALK_IN_NAME = 'Walk-in';

export const DEFAULT_SETTINGS: Record<string, string> = {
  store_name: 'General Store',
  store_name_ur: 'جنرل اسٹور',
  store_address: '',
  store_phone: '',
  store_whatsapp: '',
  currency: 'PKR',
  language: 'en',
  price_rounding: 'paisa',
  qty_precision: '3',
  valuation_method: 'wac',
  allow_negative_stock: '0',
  discount_limit_bp: '2000',
  tax_enabled: '0',
  default_tax_bp: '0',
  invoice_prefix: 'INV',
  purchase_prefix: 'PUR',
  adjustment_prefix: 'ADJ',
  return_prefix: 'RET',
  expense_prefix: 'EXP',
  receipt_footer: 'Thank you for shopping with us!',
  receipt_terms: 'Goods can be exchanged within 7 days with this receipt.',
  return_policy: 'No return on perishable items after 24 hours.',
  receipt_font_size: '10',
  receipt_language: 'en',
  auto_lock_timeout: '1min',
  pin_enabled: '1',
  pin_recovery_enabled: '0',
  backup_reminder_days: '7',
  show_urdu_names: '1',
  low_stock_source: 'min',
  operator_name: 'Owner',
};

export const DEFAULT_PAYMENT_METHODS = [
  { code: 'cash', nameEn: 'Cash', nameUr: 'نقد', isCash: 1, isCredit: 0, sort: 1 },
  { code: 'bank', nameEn: 'Bank transfer', nameUr: 'بینک ٹرانسفر', isCash: 0, isCredit: 0, sort: 2 },
  { code: 'card', nameEn: 'Card', nameUr: 'کارڈ', isCash: 0, isCredit: 0, sort: 3 },
  { code: 'wallet', nameEn: 'Mobile wallet', nameUr: 'موبائل والٹ', isCash: 0, isCredit: 0, sort: 4 },
  { code: 'raast', nameEn: 'Raast', nameUr: 'راست', isCash: 0, isCredit: 0, sort: 5 },
  { code: 'credit', nameEn: 'Credit (khata)', nameUr: 'ادھار', isCash: 0, isCredit: 1, sort: 6 },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'exp_rent', nameEn: 'Rent', nameUr: 'کرایہ' },
  { id: 'exp_electricity', nameEn: 'Electricity', nameUr: 'بجلی' },
  { id: 'exp_gas', nameEn: 'Gas', nameUr: 'گیس' },
  { id: 'exp_salaries', nameEn: 'Salaries', nameUr: 'تنخواہیں' },
  { id: 'exp_transport', nameEn: 'Transport', nameUr: 'ٹرانسپورٹ' },
  { id: 'exp_packaging', nameEn: 'Packaging', nameUr: 'پیکنگ' },
  { id: 'exp_repairs', nameEn: 'Repairs', nameUr: 'مرمت' },
  { id: 'exp_internet', nameEn: 'Internet', nameUr: 'انٹرنیٹ' },
  { id: 'exp_cleaning', nameEn: 'Cleaning', nameUr: 'صفائی' },
  { id: 'exp_misc', nameEn: 'Miscellaneous', nameUr: 'متفرق' },
];

export async function seedDefaults(tx: SqlExecutor): Promise<void> {
  const at = nowIso();

  for (const unit of BUILTIN_UNITS) {
    await tx.exec(
      `INSERT OR IGNORE INTO units (code, name_en, name_ur, dimension, canonical_micro, builtin)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [unit.code, unit.nameEn, unit.nameUr, unit.dimension, unit.canonical],
    );
  }

  for (const m of DEFAULT_PAYMENT_METHODS) {
    await tx.exec(
      `INSERT OR IGNORE INTO payment_methods (id, code, name_en, name_ur, is_cash, is_credit, is_active, sort)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [`pm_${m.code}`, m.code, m.nameEn, m.nameUr, m.isCash, m.isCredit, m.sort],
    );
  }

  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await tx.exec(
      `INSERT OR IGNORE INTO expense_categories (id, name_en, name_ur, is_active) VALUES (?, ?, ?, 1)`,
      [c.id, c.nameEn, c.nameUr],
    );
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await tx.exec('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  await tx.exec('INSERT OR IGNORE INTO categories (id, name_en, name_ur, created_at) VALUES (?, ?, ?, ?)', [
    'cat_general',
    'General',
    'عام',
    at,
  ]);
}
