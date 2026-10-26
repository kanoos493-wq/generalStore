/** Text normalization for Urdu/English search + display safety. */

const URDU_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/**
 * Normalize Urdu/Arabic script text for practical matching:
 *  - strip diacritics (harakat)
 *  - unify alef variants, yeh variants, kaf variants, heh variants
 *  - normalize Arabic-Indic digits to ASCII
 * The original stored value is never modified; this is only used for search.
 */
export function normalizeUrdu(input: string): string {
  return input
    .replace(URDU_DIACRITICS, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
    .replace(/[\u0649\u064A]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u06C1\u06D5\u0647\u06BE]/g, 'ہ')
    .replace(/\u06C3/g, 'ہ')
    .replace(/\u0629/g, 'ہ')
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u200c|\u200d|\u200e|\u200f/g, '');
}

/** Lowercased, diacritic-free, single-spaced blob used for LIKE search. */
export function normalizeSearch(...varargParts: (string | null | undefined)[]): string {
  return varargParts
    .filter((x): x is string => !!x)
    .map(p => normalizeUrdu(p).toLowerCase().trim())
    .filter(p => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Escape LIKE wildcards so a user query is always treated literally. */
export function likePattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, m => `\\${m}`);
  return `%${escaped}%`;
}

export function likePrefix(query: string): string {
  const escaped = query.replace(/[\\%_]/g, m => `\\${m}`);
  return `${escaped}%`;
}

/** Digits-only comparison for phone search. */
export function digitsOnly(input: string): string {
  return input.replace(/\D+/g, '');
}
