/**
 * Unit catalogue + product-scoped packaging / conversion engine.
 *
 * Rules (see ACCOUNTING_RULES.md):
 *  - Every product has exactly one base stock unit; stock is stored in
 *    micro base units.
 *  - A conversion factor is expressed in micro units: factor 10 for a bag
 *    means 10 base units, and is stored as 10_000_000.
 *  - Units of different physical dimensions are NEVER auto-converted
 *    (kg <-> L requires an explicit product-specific factor).
 */
import { QTY_SCALE, mulDivRound } from './money';

export type Dimension = 'mass' | 'volume' | 'count';

export interface UnitDef {
  code: string;
  nameEn: string;
  nameUr: string;
  dimension: Dimension;
  /** Factor to the canonical unit of the dimension, in micro units. */
  canonical: number;
  builtin: boolean;
}

const u = (
  code: string,
  nameEn: string,
  nameUr: string,
  dimension: Dimension,
  canonical: number,
): UnitDef => ({ code, nameEn, nameUr, dimension, canonical, builtin: true });

export const BASE_UNIT_CODES: Record<Dimension, string> = {
  mass: 'kg',
  volume: 'l',
  count: 'piece',
};

/** Built-in units shipped with the app (extendable with custom units). */
export const BUILTIN_UNITS: UnitDef[] = [
  // mass — canonical kg
  u('kg', 'Kilogram', 'کلوگرام', 'mass', QTY_SCALE),
  u('g', 'Gram', 'گرام', 'mass', QTY_SCALE / 1000),
  u('mg', 'Milligram', 'ملی گرام', 'mass', 1),
  // volume — canonical litre
  u('l', 'Litre', 'لیٹر', 'volume', QTY_SCALE),
  u('ml', 'Millilitre', 'ملی لیٹر', 'volume', QTY_SCALE / 1000),
  // count — canonical piece
  u('piece', 'Piece', 'عدد', 'count', QTY_SCALE),
  u('dozen', 'Dozen', 'درجن', 'count', 12 * QTY_SCALE),
  u('packet', 'Packet', 'پیکٹ', 'count', QTY_SCALE),
  u('pack', 'Pack', 'پیک', 'count', QTY_SCALE),
  u('bottle', 'Bottle', 'بوتل', 'count', QTY_SCALE),
  u('can', 'Can', 'کین', 'count', QTY_SCALE),
  u('pet', 'PET bottle', 'پیٹ بوتل', 'count', QTY_SCALE),
  u('bundle', 'Bundle', 'بنڈل', 'count', QTY_SCALE),
  u('tray', 'Tray', 'ٹرے', 'count', QTY_SCALE),
  // packaging — always product-specific, canonical factor is informational
  u('box', 'Box', 'ڈبہ', 'count', 6 * QTY_SCALE),
  u('carton', 'Carton', 'کارٹن', 'count', 20 * 6 * QTY_SCALE),
  u('bag', 'Bag', 'بوری', 'count', 10 * QTY_SCALE),
  u('sack', 'Sack', 'بوری', 'count', 50 * QTY_SCALE),
  u('crate', 'Crate', 'کریٹ', 'count', 12 * QTY_SCALE),
  // free-form custom units commonly used in Pakistani stores
  u('tin', 'Tin', 'ٹن', 'count', QTY_SCALE),
  u('jar', 'Jar', 'جار', 'count', QTY_SCALE),
  u('roll', 'Roll', 'رول', 'count', QTY_SCALE),
  u('sachet', 'Sachet', 'ساشے', 'count', QTY_SCALE),
  u('drum', 'Drum', 'ڈرم', 'count', QTY_SCALE),
];

/** Units whose factor is always defined per product (packaging units). */
export const PACKAGING_UNIT_CODES = new Set([
  'box', 'carton', 'bag', 'sack', 'crate', 'bundle', 'tray', 'pack', 'drum', 'roll',
]);

export function findUnit(code: string): UnitDef | undefined {
  return BUILTIN_UNITS.find(x => x.code === code);
}

export function dimensionOf(code: string, custom?: UnitDef[]): Dimension | undefined {
  return findUnit(code)?.dimension ?? custom?.find(x => x.code === code)?.dimension;
}

/**
 * Default conversion factor from `baseUnit` to `unit`, in micro units.
 * Returns null when the dimensions differ (an explicit product-specific
 * factor is then required and the UI must ask for it).
 */
export function defaultFactorMicro(
  baseUnit: string,
  unit: string,
  custom: UnitDef[] = [],
): number | null {
  if (baseUnit === unit) {return QTY_SCALE;}
  const all = [...BUILTIN_UNITS, ...custom];
  const b = all.find(x => x.code === baseUnit);
  const t = all.find(x => x.code === unit);
  if (!b || !t) {return null;}
  if (b.dimension !== t.dimension) {return null;}
  return mulDivRound(t.canonical, QTY_SCALE, b.canonical);
}

/** True when the factor is physically valid for the given units. */
export function isFactorValid(
  baseUnit: string,
  unit: string,
  factorMicro: number,
  custom: UnitDef[] = [],
): boolean {
  if (!Number.isFinite(factorMicro) || factorMicro <= 0) {return false;}
  const all = [...BUILTIN_UNITS, ...custom];
  const b = all.find(x => x.code === baseUnit);
  const t = all.find(x => x.code === unit);
  if (!t) {return true;} // custom unknown unit: accept (dimension checked at creation)
  if (!b) {return true;}
  // same dimension: any positive factor is physically coherent
  if (b.dimension === t.dimension) {return true;}
  // cross dimension: only allowed when explicitly configured per product
  return factorMicro > 0;
}

/** Convert an entered quantity (in `unit`) into micro base units. */
export function toBaseQty(enteredQtyMicro: number, factorMicro: number): number {
  return mulDivRound(enteredQtyMicro, factorMicro, QTY_SCALE);
}

/** Convert a micro base quantity into `unit`. */
export function fromBaseQty(baseQtyMicro: number, factorMicro: number): number {
  if (!factorMicro) {throw new Error('Conversion factor must be positive');}
  return mulDivRound(baseQtyMicro, QTY_SCALE, factorMicro);
}

/** Describe a mixed-unit order such as 4 cartons + 10 boxes + 4 pieces. */
export interface MixedQuantityPart {
  unitId: string;
  qtyMicro: number;
  factorMicro: number;
}

export function mixedToBase(parts: MixedQuantityPart[]): number {
  let total = 0;
  for (const p of parts) {total += toBaseQty(p.qtyMicro, p.factorMicro);}
  return total;
}

/** Suggested packaging breakdown for restock display (largest unit first). */
export function breakdownBaseQty(
  baseQtyMicro: number,
  units: { unitId: string; factorMicro: number }[],
): { unitId: string; qtyMicro: number }[] {
  const sorted = [...units].sort((a, b) => b.factorMicro - a.factorMicro);
  let remaining = baseQtyMicro;
  const out: { unitId: string; qtyMicro: number }[] = [];
  for (const unit of sorted) {
    if (remaining >= unit.factorMicro) {
      const whole = Math.floor(remaining / unit.factorMicro);
      out.push({ unitId: unit.unitId, qtyMicro: whole * QTY_SCALE });
      remaining -= whole * unit.factorMicro;
    }
  }
  if (remaining > 0) {
    out.push({ unitId: sorted[sorted.length - 1]?.unitId ?? 'piece', qtyMicro: remaining });
  }
  return out;
}
