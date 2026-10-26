/** Display formatting bound to the current store settings and language. */
import { formatMoney, formatQty } from '../core/money';
import { formatDate, formatDateTime, formatTime } from '../core/dates';
import { useAppStore } from './store/appStore';

export function useFormat() {
  const language = useAppStore(s => s.language);
  const settings = useAppStore(s => s.settings);
  const currency = settings?.currency ?? 'PKR';
  const precision = settings?.qtyPrecision ?? 3;
  const locale = language === 'ur' ? 'ur-PK' : 'en-GB';

  return {
    money: (paisa: number | null | undefined) => `${currency} ${formatMoney(Number(paisa ?? 0))}`,
    moneyPlain: (paisa: number | null | undefined) => formatMoney(Number(paisa ?? 0)),
    number: (paisa: number | null | undefined) => formatMoney(Number(paisa ?? 0), { decimals: 0 }),
    qty: (micro: number | null | undefined, unit?: string | null) => {
      const value = formatQty(Number(micro ?? 0), precision);
      return unit ? `${value} ${unit}` : value;
    },
    date: (iso: string | null | undefined) => (iso ? formatDate(iso, locale) : '—'),
    time: (iso: string | null | undefined) => (iso ? formatTime(iso, locale) : '—'),
    dateTime: (iso: string | null | undefined) => (iso ? formatDateTime(iso, locale) : '—'),
    percent: (bp: number) => `${(bp / 100).toFixed(1)}%`,
    currency,
    locale,
  };
}

export function signedMoney(paisa: number): string {
  return `${paisa > 0 ? '+' : ''}${formatMoney(paisa)}`;
}
