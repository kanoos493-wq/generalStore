import { cartTotals, useCart, type CartItem } from '../../src/app/store/cartStore';
import { QTY_SCALE } from '../../src/core/money';

const KG = QTY_SCALE;

function line(over: Partial<CartItem> = {}): Omit<CartItem, 'key' | 'lineDiscountPaisa'> {
  return {
    productId: 'p1',
    name: 'Sugar',
    baseUnit: 'kg',
    unitCode: 'kg',
    factorMicro: KG,
    qtyMicro: 2 * KG,
    unitPricePaisa: 15000,
    stockMicro: 100 * KG,
    taxBp: 0,
    ...over,
  };
}

beforeEach(() => {
  useCart.getState().clear();
});

describe('POS cart store', () => {
  it('adds a line and totals it', () => {
    useCart.getState().add(line());
    const totals = cartTotals(useCart.getState());
    expect(totals.itemCount).toBe(1);
    expect(totals.subtotalPaisa).toBe(30000); // 2 kg x PKR 150
    expect(totals.totalPaisa).toBe(30000);
  });

  it('supports fractional quantities (500 g of sugar)', () => {
    useCart.getState().add(line({ unitCode: 'g', factorMicro: 1000, qtyMicro: 500 * KG }));
    // Unit price entered per gram = 15000 paisa / 1000
    useCart.getState().update(useCart.getState().items[0].key, { unitPricePaisa: 15 });
    const totals = cartTotals(useCart.getState());
    expect(totals.subtotalPaisa).toBe(7500); // PKR 75
  });

  it('merges the same product, unit and price into one line', () => {
    useCart.getState().add(line({ qtyMicro: KG }));
    useCart.getState().add(line({ qtyMicro: 3 * KG }));
    const state = useCart.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].qtyMicro).toBe(4 * KG);
  });

  it('keeps lines separate when the price differs', () => {
    useCart.getState().add(line({ unitPricePaisa: 15000 }));
    useCart.getState().add(line({ unitPricePaisa: 16000 }));
    expect(useCart.getState().items).toHaveLength(2);
    expect(cartTotals(useCart.getState()).subtotalPaisa).toBe(62000); // 2x150 + 2x160
  });

  it('applies line discounts before the cart discount', () => {
    useCart.getState().add(line());
    const key = useCart.getState().items[0].key;
    useCart.getState().update(key, { lineDiscountPaisa: 2000 });
    useCart.getState().setDiscount({ discountBp: 1000 }); // 10%
    const totals = cartTotals(useCart.getState());
    expect(totals.subtotalPaisa).toBe(30000);
    expect(totals.lineDiscountPaisa).toBe(2000);
    expect(totals.cartDiscountPaisa).toBe(2800); // 10% of 28,000
    expect(totals.totalPaisa).toBe(25200);
  });

  it('never discounts below zero', () => {
    useCart.getState().add(line());
    useCart.getState().setDiscount({ discountPaisa: 999999 });
    const totals = cartTotals(useCart.getState());
    expect(totals.cartDiscountPaisa).toBe(30000);
    expect(totals.totalPaisa).toBe(0);
  });

  it('adds tax on the discounted line amount', () => {
    useCart.getState().add(line({ taxBp: 1700 }));
    const totals = cartTotals(useCart.getState());
    expect(totals.taxPaisa).toBe(5100); // 17% of 30,000
    expect(totals.totalPaisa).toBe(35100);
  });

  it('removes lines and clamps negative quantities', () => {
    useCart.getState().add(line());
    const key = useCart.getState().items[0].key;
    useCart.getState().setQuantity(key, -5);
    expect(useCart.getState().items[0].qtyMicro).toBe(0);
    useCart.getState().remove(key);
    expect(useCart.getState().items).toHaveLength(0);
  });

  it('clears the cart and rotates the client reference for the next sale', () => {
    useCart.getState().add(line());
    useCart.getState().setCustomer('c1', 'Ali');
    const before = useCart.getState().clientRef;
    useCart.getState().clear();
    const state = useCart.getState();
    expect(state.items).toHaveLength(0);
    expect(state.customerId).toBeNull();
    expect(state.clientRef).not.toBe(before);
  });
});
