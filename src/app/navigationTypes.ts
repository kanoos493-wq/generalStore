export type PartyType = 'customer' | 'supplier';

export interface PrefilledPurchaseLine {
  productId: string;
  unitCode: string;
  qtyMicro: number;
  unitCostPaisa: number;
}

export type RootStackParamList = {
  Tabs: undefined;
  ProductForm: { productId?: string } | undefined;
  ProductDetail: { productId: string };
  SaleDetail: { saleId: string };
  PurchaseForm: { supplierId?: string; lines?: PrefilledPurchaseLine[] } | undefined;
  PurchaseDetail: { purchaseId: string };
  PartyList: { partyType: PartyType };
  PartyForm: { partyType: PartyType; partyId?: string };
  PartyDetail: { partyType: PartyType; partyId: string };
  StockAdjustments: undefined;
  AdjustmentForm: undefined;
  Restock: undefined;
  Expenses: undefined;
  CashClosing: undefined;
  Reports: undefined;
  ReportView: { reportId: string };
  SalesHistory: undefined;
  PurchasesHistory: undefined;
  Returns: undefined;
  Settings: undefined;
  Security: undefined;
  Backup: undefined;
  Help: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Pos: undefined;
  Products: undefined;
  More: undefined;
};
