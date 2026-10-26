/** POS cart, kept in a store so navigating away never loses a sale in progress. */
import { create } from 'zustand';
import { QTY_SCALE, mulDivRound } from '../../core/money';

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  baseUnit: string;
  unitCode: string;
  factorMicro: number;
  qtyMicro: number;
  unitPricePaisa: number;
  lineDiscountPaisa: number;
  stockMicro: number;
  taxBp: number;
}

export interface CartState {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  discountBp: number;
  discountPaisa: number;
  clientRef: string;
  add: (item: Omit<CartItem, 'key' | 'lineDiscountPaisa'>) => void;
  update: (key: string, patch: Partial<CartItem>) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, qtyMicro: number) => void;
  setCustomer: (id: string | null, name: string | null) => void;
  setDiscount: (patch: { discountBp?: number; discountPaisa?: number }) => void;
  clear: () => void;
  newClientRef: () => void;
}

let counter = 0;
const makeRef = () => `pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useCart = create<CartState>()((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  discountBp: 0,
  discountPaisa: 0,
  clientRef: makeRef(),

  add: item => {
    const existing = get().items.find(
      i => i.productId === item.productId && i.unitCode === item.unitCode && i.unitPricePaisa === item.unitPricePaisa,
    );
    if (existing) {
      set({
        items: get().items.map(i =>
          i.key === existing.key
            ? { ...i, qtyMicro: i.qtyMicro + item.qtyMicro }
            : i,
        ),
      });
      return;
    }
    set({
      items: [
        ...get().items,
        { ...item, key: `ci${(counter += 1)}`, lineDiscountPaisa: 0 },
      ],
    });
  },

  update: (key, patch) =>
    set({ items: get().items.map(i => (i.key === key ? { ...i, ...patch } : i)) }),

  remove: key => set({ items: get().items.filter(i => i.key !== key) }),

  setQuantity: (key, qtyMicro) =>
    set({
      items: get().items.map(i => (i.key === key ? { ...i, qtyMicro: Math.max(0, Math.round(qtyMicro)) } : i)),
    }),

  setCustomer: (id, name) => set({ customerId: id, customerName: name }),
  setDiscount: patch =>
    set({
      discountBp: Math.max(0, Math.round(patch.discountBp ?? get().discountBp)),
      discountPaisa: Math.max(0, Math.round(patch.discountPaisa ?? get().discountPaisa)),
    }),

  clear: () =>
    set({
      items: [],
      customerId: null,
      customerName: null,
      discountBp: 0,
      discountPaisa: 0,
      clientRef: makeRef(),
    }),

  newClientRef: () => set({ clientRef: makeRef() }),
}));

export interface CartTotals {
  subtotalPaisa: number;
  lineDiscountPaisa: number;
  cartDiscountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  itemCount: number;
}

/** Local preview of the bill; the service recalculates authoritatively on save. */
export function cartTotals(state: Pick<CartState, 'items' | 'discountBp' | 'discountPaisa'>): CartTotals {
  let subtotal = 0;
  let lineDiscount = 0;
  let tax = 0;
  for (const item of state.items) {
    const gross = mulDivRound(item.unitPricePaisa, item.qtyMicro, QTY_SCALE);
    const net = gross - item.lineDiscountPaisa;
    subtotal += gross;
    lineDiscount += item.lineDiscountPaisa;
    tax += item.taxBp ? mulDivRound(net, item.taxBp, 10000) : 0;
  }
  const afterLines = subtotal - lineDiscount;
  const cartDiscount = Math.min(
    afterLines,
    (state.discountBp ? mulDivRound(afterLines, state.discountBp, 10000) : 0) + state.discountPaisa,
  );
  return {
    subtotalPaisa: subtotal,
    lineDiscountPaisa: lineDiscount,
    cartDiscountPaisa: cartDiscount,
    taxPaisa: tax,
    totalPaisa: afterLines - cartDiscount + tax,
    itemCount: state.items.length,
  };
}
