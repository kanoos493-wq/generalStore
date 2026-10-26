/** Date helpers. All timestamps are stored as UTC ISO-8601 strings. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  return new Date(x.getTime() - 1);
}

export interface DateRange {
  from: string;
  to: string;
}

export function dayRange(d: Date = new Date()): DateRange {
  return { from: startOfDay(d).toISOString(), to: endOfDay(d).toISOString() };
}

export function rangeForPreset(
  preset: 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all',
  at: Date = new Date(),
): DateRange {
  const base = startOfDay(at);
  switch (preset) {
    case 'today':
      return dayRange(at);
    case 'yesterday': {
      const y = new Date(base.getTime() - 86400000);
      return dayRange(y);
    }
    case 'week': {
      const start = new Date(base);
      start.setDate(start.getDate() - 6);
      return { from: start.toISOString(), to: endOfDay(at).toISOString() };
    }
    case 'month': {
      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      return { from: start.toISOString(), to: endOfDay(at).toISOString() };
    }
    case 'year': {
      const start = new Date(base.getFullYear(), 0, 1);
      return { from: start.toISOString(), to: endOfDay(at).toISOString() };
    }
    case 'all':
    default:
      return { from: new Date(0).toISOString(), to: endOfDay(at).toISOString() };
  }
}

/** yyyy-mm-dd in local time, used for date pickers and document numbers. */
export function toDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function formatDate(iso: string, locale: string = 'en-GB'): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatTime(iso: string, locale: string = 'en-GB'): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

export function formatDateTime(iso: string, locale: string = 'en-GB'): string {
  return `${formatDate(iso, locale)} ${formatTime(iso, locale)}`;
}

/** Document period key such as 2026-10 used by report grouping. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86400000);
}
