/** Role based permissions, enforced in the service layer (not only in the UI). */

export type Role = 'owner' | 'manager' | 'cashier' | 'inventory' | 'accountant';

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export const OWNER: Actor = { id: 'owner', name: 'Owner', role: 'owner' };

export type Permission =
  | 'sale.create'
  | 'sale.return'
  | 'sale.discount.override'
  | 'product.manage'
  | 'stock.adjust'
  | 'purchase.manage'
  | 'payment.record'
  | 'expense.manage'
  | 'cash.close'
  | 'report.view'
  | 'settings.manage'
  | 'backup.manage'
  | 'security.manage';

const ALL: Permission[] = [
  'sale.create',
  'sale.return',
  'sale.discount.override',
  'product.manage',
  'stock.adjust',
  'purchase.manage',
  'payment.record',
  'expense.manage',
  'cash.close',
  'report.view',
  'settings.manage',
  'backup.manage',
  'security.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: ALL.filter(p => p !== 'security.manage'),
  cashier: ['sale.create', 'payment.record', 'cash.close'],
  inventory: ['product.manage', 'stock.adjust', 'purchase.manage'],
  accountant: ['report.view', 'payment.record', 'expense.manage'],
};

export const ROLE_LABELS: Record<Role, { en: string; ur: string }> = {
  owner: { en: 'Owner', ur: 'مالک' },
  manager: { en: 'Manager', ur: 'منیجر' },
  cashier: { en: 'Cashier', ur: 'کیشئر' },
  inventory: { en: 'Inventory operator', ur: 'اسٹاک آپریٹر' },
  accountant: { en: 'Accountant', ur: 'اکاؤنٹنٹ' },
};

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = 'PermissionError';
  }
}

export function can(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new PermissionError(permission);
  }
}
