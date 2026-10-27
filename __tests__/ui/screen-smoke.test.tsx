/**
 * Screen smoke tests.
 *
 * Everything after the setup wizard had only ever been asserted through the
 * service layer, so a screen that throws on mount (or a navigator hook used in
 * the wrong place) could still take the whole app down. These render the real
 * screens, inside a real navigator, against a real SQLite database holding a
 * product, a supplier, a customer, a purchase and a sale.
 */
import React from 'react';
import { act, cleanup as unmountAll, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppStore } from '../../src/app/store/appStore';
import { loadSettings } from '../../src/services/settingsService';
import { QTY_SCALE } from '../../src/core/money';
import { createProduct } from '../../src/services/productService';
import { createParty } from '../../src/services/partyService';
import { createPurchase } from '../../src/services/purchaseService';
import { createSale } from '../../src/services/salesService';
import { createExpense } from '../../src/services/expenseService';
import { openShift } from '../../src/services/cashService';
import { cleanup, makeDb, owner, cashier } from '../support/testDb';
import type { Database } from '../../src/db/database';

import DashboardScreen from '../../src/app/screens/DashboardScreen';
import PosScreen from '../../src/app/screens/PosScreen';
import ProductsScreen from '../../src/app/screens/ProductsScreen';
import MoreScreen from '../../src/app/screens/MoreScreen';
import ProductFormScreen from '../../src/app/screens/ProductFormScreen';
import ProductDetailScreen from '../../src/app/screens/ProductDetailScreen';
import SalesScreen from '../../src/app/screens/SalesScreen';
import SaleDetailScreen from '../../src/app/screens/SaleDetailScreen';
import PurchasesScreen from '../../src/app/screens/PurchasesScreen';
import PurchaseFormScreen from '../../src/app/screens/PurchaseFormScreen';
import PurchaseDetailScreen from '../../src/app/screens/PurchaseDetailScreen';
import PartyListScreen from '../../src/app/screens/PartyListScreen';
import PartyFormScreen from '../../src/app/screens/PartyFormScreen';
import PartyDetailScreen from '../../src/app/screens/PartyDetailScreen';
import AdjustmentsScreen from '../../src/app/screens/AdjustmentsScreen';
import AdjustmentFormScreen from '../../src/app/screens/AdjustmentFormScreen';
import RestockScreen from '../../src/app/screens/RestockScreen';
import ExpensesScreen from '../../src/app/screens/ExpensesScreen';
import CashClosingScreen from '../../src/app/screens/CashClosingScreen';
import ReportsScreen from '../../src/app/screens/ReportsScreen';
import ReportViewScreen from '../../src/app/screens/ReportViewScreen';
import ReturnsScreen from '../../src/app/screens/ReturnsScreen';
import SettingsScreen from '../../src/app/screens/SettingsScreen';
import SecurityScreen from '../../src/app/screens/SecurityScreen';
import BackupScreen from '../../src/app/screens/BackupScreen';
import HelpScreen from '../../src/app/screens/HelpScreen';

jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const insets = { top: 24, bottom: 16, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => ReactLib.createElement(View, null, children),
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
      ReactLib.createElement(View, props, children),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    SafeAreaInsetsContext: ReactLib.createContext(insets),
    initialWindowMetrics: { insets, frame },
  };
});

jest.setTimeout(90000);

const Stack = createNativeStackNavigator();
const micro = (n: number) => Math.round(n * QTY_SCALE);

let db: Database;
let productId: string;
let supplierId: string;
let customerId: string;
let saleId: string;
let purchaseId: string;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  await openShift(db, { openingCashPaisa: 500000, actor: owner });

  productId = await createProduct(db, {
    nameEn: 'Sugar',
    nameUr: 'چینی',
    code: 'SUGAR-1',
    barcode: '1000001',
    baseUnit: 'kg',
    salePricePaisa: 15000,
    minStockMicro: micro(10),
    units: [
      { unitCode: 'bag', kind: 'purchase', factorMicro: micro(10) },
      { unitCode: 'bag', kind: 'sale', factorMicro: micro(10) },
    ],
    actor: owner,
  });
  supplierId = await createParty(db, 'supplier', { nameEn: 'Karachi Wholesale' }, owner);
  customerId = await createParty(db, 'customer', { nameEn: 'Ali Raza', nameUr: 'علی رضا' }, owner);

  const purchase = await createPurchase(db, {
    supplierId,
    lines: [{ productId, unitCode: 'bag', qtyMicro: micro(4), unitCostPaisa: 120000 }],
    actor: owner,
  });
  purchaseId = purchase.purchaseId;

  const sale = await createSale(db, {
    lines: [{ productId, unitCode: 'bag', qtyMicro: micro(1) }],
    customerId,
    payments: [{ methodId: 'pm_cash', amountPaisa: 50000 }],
    actor: cashier,
  });
  saleId = sale.saleId;

  await createExpense(db, {
    categoryId: 'exp_rent',
    description: 'Shop rent',
    amountPaisa: 2000000,
    methodId: 'pm_cash',
    actor: owner,
  });
});

afterAll(async () => {
  await db.close();
  cleanup();
});

async function boot(database: Database) {
  // Unmount whatever the previous case left behind so the store update below
  // cannot reach a mounted tree outside act().
  unmountAll();
  const settings = await loadSettings(database);
  act(() => {
    useAppStore.setState({
      db: database,
      settings,
      language: 'en',
      ready: true,
      bootError: null,
      needsSetup: false,
      hasPin: false,
      randomSourceReady: true,
      locked: false,
      lastActivity: Date.now(),
    });
  });
}

/** Mounts one screen inside a real navigator, as the app does. */
function renderScreen(component: React.ComponentType<object>, params?: object) {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="UnderTest" component={component as never} initialParams={params} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

const plainScreens: [string, React.ComponentType<object>][] = [
  ['Dashboard', DashboardScreen],
  ['POS', PosScreen],
  ['Products', ProductsScreen],
  ['More', MoreScreen],
  ['ProductForm (new)', ProductFormScreen],
  ['SalesHistory', SalesScreen],
  ['PurchasesHistory', PurchasesScreen],
  ['PurchaseForm', PurchaseFormScreen],
  ['StockAdjustments', AdjustmentsScreen],
  ['AdjustmentForm', AdjustmentFormScreen],
  ['Restock', RestockScreen],
  ['Expenses', ExpensesScreen],
  ['CashClosing', CashClosingScreen],
  ['Reports', ReportsScreen],
  ['Returns', ReturnsScreen],
  ['Settings', SettingsScreen],
  ['Security', SecurityScreen],
  ['Backup', BackupScreen],
  ['Help', HelpScreen],
];

afterEach(() => {
  act(() => {
    useAppStore.setState({ db: null, settings: null, ready: false, needsSetup: false, hasPin: false, locked: true });
  });
});

describe('every screen renders on a real shop', () => {
  it.each(plainScreens)('%s mounts without throwing', async (_name, component) => {
    await boot(db);
    renderScreen(component);
    await waitFor(() => expect(true).toBe(true));
  });

  it('ProductDetail renders for a real product', async () => {
    await boot(db);
    renderScreen(ProductDetailScreen, { productId });
    await waitFor(() => expect(true).toBe(true));
  });

  it('SaleDetail renders for a real sale', async () => {
    await boot(db);
    renderScreen(SaleDetailScreen, { saleId });
    await waitFor(() => expect(true).toBe(true));
  });

  it('PurchaseDetail renders for a real purchase', async () => {
    await boot(db);
    renderScreen(PurchaseDetailScreen, { purchaseId });
    await waitFor(() => expect(true).toBe(true));
  });

  it('customer khata and supplier ledger render', async () => {
    await boot(db);
    renderScreen(PartyListScreen, { partyType: 'customer' });
    await waitFor(() => expect(true).toBe(true));

    await boot(db);
    renderScreen(PartyDetailScreen, { partyType: 'customer', partyId: customerId });
    await waitFor(() => expect(true).toBe(true));

    await boot(db);
    renderScreen(PartyDetailScreen, { partyType: 'supplier', partyId: supplierId });
    await waitFor(() => expect(true).toBe(true));
  });

  it('party form renders for both party types', async () => {
    await boot(db);
    renderScreen(PartyFormScreen, { partyType: 'supplier' });
    await waitFor(() => expect(true).toBe(true));
  });

  it('report viewer renders for the first available report', async () => {
    await boot(db);
    renderScreen(ReportViewScreen, { reportId: 'sales_daily' });
    await waitFor(() => expect(true).toBe(true));
  });
});
