import { QTY_SCALE } from '../../src/core/money';
import {
  breakdownBaseQty,
  defaultFactorMicro,
  fromBaseQty,
  mixedToBase,
  toBaseQty,
} from '../../src/core/units';

const micro = (n: number) => Math.round(n * QTY_SCALE);
const kgPerBag = 10;
const bagFactor = micro(kgPerBag);

describe('unit conversion engine', () => {
  it('converts one bag into 10 kg (base units)', () => {
    expect(toBaseQty(micro(1), bagFactor)).toBe(micro(10));
  });

  it('converts 4 bags + 4 kg into 44 kg', () => {
    const total = mixedToBase([
      { unitId: 'bag', qtyMicro: micro(4), factorMicro: bagFactor },
      { unitId: 'kg', qtyMicro: micro(4), factorMicro: QTY_SCALE },
    ]);
    expect(total).toBe(micro(44));
  });

  it('converts grams to kilograms', () => {
    expect(toBaseQty(micro(500), micro(0.001))).toBe(micro(0.5));
    expect(toBaseQty(micro(100), micro(0.001))).toBe(micro(0.1));
    expect(toBaseQty(micro(750), micro(0.001))).toBe(micro(0.75));
    expect(toBaseQty(micro(1.25), QTY_SCALE)).toBe(micro(1.25));
  });

  it('defaults g -> kg without asking the user', () => {
    expect(defaultFactorMicro('kg', 'g')).toBe(micro(0.001));
    expect(defaultFactorMicro('kg', 'kg')).toBe(QTY_SCALE);
  });

  it('handles the box / carton hierarchy (1 carton = 20 boxes = 120 pieces)', () => {
    const boxPieces = micro(6);
    const cartonPieces = micro(120);
    expect(toBaseQty(micro(20), boxPieces)).toBe(micro(120));
    expect(toBaseQty(micro(1), cartonPieces)).toBe(micro(120));
  });

  it('adds mixed piece/box/carton quantities: 4 cartons + 10 boxes + 4 pieces = 544', () => {
    const total = mixedToBase([
      { unitId: 'carton', qtyMicro: micro(4), factorMicro: micro(120) },
      { unitId: 'box', qtyMicro: micro(10), factorMicro: micro(6) },
      { unitId: 'piece', qtyMicro: micro(4), factorMicro: QTY_SCALE },
    ]);
    expect(total).toBe(micro(544));
  });

  it('keeps fractional packages exact', () => {
    expect(toBaseQty(micro(2.5), bagFactor)).toBe(micro(25));
    expect(toBaseQty(micro(0.25), bagFactor)).toBe(micro(2.5));
  });

  it('never converts mass into volume implicitly', () => {
    expect(defaultFactorMicro('kg', 'l')).toBeNull();
    expect(defaultFactorMicro('l', 'kg')).toBeNull();
    expect(defaultFactorMicro('piece', 'kg')).toBeNull();
  });

  it('round-trips base quantities back into a unit', () => {
    expect(fromBaseQty(micro(0.5), micro(0.001))).toBe(micro(500));
    expect(fromBaseQty(micro(44), bagFactor)).toBe(micro(4.4));
  });

  it('breaks a base quantity into the largest packaging units', () => {
    const parts = breakdownBaseQty(micro(544), [
      { unitId: 'carton', factorMicro: micro(120) },
      { unitId: 'box', factorMicro: micro(6) },
      { unitId: 'piece', factorMicro: QTY_SCALE },
    ]);
    expect(parts).toEqual([
      { unitId: 'carton', qtyMicro: micro(4) },
      { unitId: 'box', qtyMicro: micro(10) },
      { unitId: 'piece', qtyMicro: micro(4) },
    ]);
  });
});
