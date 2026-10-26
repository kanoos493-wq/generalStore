/**
 * Language hook. The string table lives in `strings.ts` (pure, testable);
 * this file only wires it to the current store language.
 */
import { useCallback } from 'react';
import { useAppStore } from './store/appStore';
import { translate, type Language } from './strings';

export type { Language };
export { translate };

export function useI18n() {
  const language = useAppStore(s => s.language);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
  return {
    t,
    lang: language,
    rtl: language === 'ur',
    row: language === 'ur' ? ('row-reverse' as const) : ('row' as const),
  };
}
