/** Guards against untranslated labels sneaking into the UI. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { STRING_KEYS, translate } from '../../src/app/strings';

const APP_DIR = path.join(__dirname, '..', '..', 'src', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('localization', () => {
  it('has non-empty English and Urdu text for every key', () => {
    for (const key of STRING_KEYS) {
      expect(translate('en', key).trim().length).toBeGreaterThan(0);
      const urdu = translate('ur', key);
      expect(urdu.trim().length).toBeGreaterThan(0);
      // Urdu strings must contain Urdu script (or be numeric/punctuation only)
      expect(/[\u0600-\u06FF]/.test(urdu) || /^[\d\s%.:/+-]+$/.test(urdu)).toBe(true);
    }
  });

  it('resolves every t() key used in the app', () => {
    const used = new Set<string>();
    for (const file of walk(APP_DIR)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const match of content.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) {
        used.add(match[1]);
      }
    }
    const missing = [...used].filter(key => !STRING_KEYS.includes(key));
    expect(missing).toEqual([]);
  });

  it('falls back to the key and interpolates variables', () => {
    expect(translate('en', 'notARealKey')).toBe('notARealKey');
    expect(translate('en', 'save')).toBe('Save');
    expect(translate('ur', 'save')).toBe('محفوظ کریں');
  });
});
