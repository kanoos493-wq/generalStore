/** Product catalogue: CRUD, packaging units, barcodes, search and history. */
import type { Database, Tx } from '../db/database';
import type { ProductRow, ProductUnitRow } from '../db/types';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import { NotFoundError, ValidationError } from '../core/errors';
import { assertCan, type Actor } from '../core/permissions';
import { likePattern, normalizeSearch } from '../core/text';
import { isFactorValid, defaultFactorMicro } from '../core/units';
import { QTY_SCALE } from '../core/money';
import { audit } from './auditService';
import { applyStockMovement } from './stockService';
import { nextDocNo } from './numbering';

export interface ProductUnitInput {
  unitCode: string;
  kind: 'purchase' | 'sale';
  factorMicro: number;
  pricePaisa?: number | null;
  isDefault?: boolean;
}

export interface ProductInput {
  nameEn: string;
  nameUr?: string | null;
  code?: string | null;
  barcode?: string | null;
  extraBarcodes?: string[];
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  baseUnit: string;
  salePricePaisa: number;
  costPaisa?: number;
  minStockMicro?: number;
  targetStockMicro?: number;
  reorderQtyMicro?: number;
  trackExpiry?: boolean;
  notes?: string | null;
  units?: ProductUnitInput[];
  openingStockMicro?: number;
  openingCostPaisa?: number;
  actor: Actor;
}

async function buildSearchBlob(tx: Tx, product: {
  nameEn: string;
  nameUr?: string | null;
  code: string;
  barcode?: string | null;
  extraBarcodes?: string[];
}): Promise<string> {
  return normalizeSearch(product.nameEn, product.nameUr, product.code, product.barcode, ...(product.extraBarcodes ?? []));
}

async function nextProductCode(tx: Tx): Promise<string> {
  const row = await tx.one<{ next: number }>(`SELECT COUNT(*) + 1 AS next FROM products`);
  void row;
  const docNo = await nextDocNo(tx, { scope: 'product', prefix: 'P', date: new Date() });
  return docNo.replace(/^P-\d{8}-/, 'P');
}

export async function createProduct(db: Database, input: ProductInput): Promise<string> {
  assertCan(input.actor.role, 'product.manage');
  if (!input.nameEn.trim()) {throw new ValidationError('Product name is required', 'nameEn');}
  if (input.salePricePaisa < 0) {throw new ValidationError('Selling price cannot be negative', 'price');}

  return db.tx(async tx => {
    const unit = await tx.one<{ code: string }>('SELECT code FROM units WHERE code = ?', [input.baseUnit]);
    if (!unit) {throw new ValidationError('Select a valid base unit', 'baseUnit');}

    const code = (input.code ?? '').trim() || (await nextProductCode(tx));
    const duplicate = await tx.one<{ id: string }>('SELECT id FROM products WHERE code = ?', [code]);
    if (duplicate) {throw new ValidationError(`Product code ${code} already exists`, 'code');}
    if (input.barcode) {
      const bc = await tx.one<{ id: string }>('SELECT id FROM products WHERE barcode = ?', [input.barcode]);
      if (bc) {throw new ValidationError('Barcode is already used by another product', 'barcode');}
    }

    const id = newId('prod');
    const at = nowIso();
    const blob = await buildSearchBlob(tx, {
      nameEn: input.nameEn,
      nameUr: input.nameUr,
      code,
      barcode: input.barcode,
      extraBarcodes: input.extraBarcodes,
    });
    await tx.exec(
      `INSERT INTO products (id, code, name_en, name_ur, barcode, category_id, brand_id, supplier_id, base_unit,
         sale_price_paisa, cost_paisa, stock_micro, min_stock_micro, target_stock_micro, reorder_qty_micro,
         track_expiry, tax_bp, is_active, notes, search_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
      [
        id,
        code,
        input.nameEn.trim(),
        input.nameUr ?? null,
        input.barcode ?? null,
        input.categoryId ?? null,
        input.brandId ?? null,
        input.supplierId ?? null,
        input.baseUnit,
        Math.round(input.salePricePaisa),
        Math.round(input.costPaisa ?? 0),
        Math.round(input.minStockMicro ?? 0),
        Math.round(input.targetStockMicro ?? 0),
        Math.round(input.reorderQtyMicro ?? 0),
        input.trackExpiry ? 1 : 0,
        input.notes ?? null,
        blob,
        at,
        at,
      ],
    );

    await writeUnits(tx, id, input.baseUnit, input.units ?? []);
    await writeBarcodes(tx, id, [input.barcode ?? null, ...(input.extraBarcodes ?? [])], at);

    if (input.openingStockMicro && input.openingStockMicro > 0) {
      await applyStockMovement(tx, {
        productId: id,
        deltaMicro: Math.round(input.openingStockMicro),
        type: 'opening',
        unitCode: input.baseUnit,
        enteredQtyMicro: Math.round(input.openingStockMicro),
        factorMicro: QTY_SCALE,
        unitCostPaisa: input.openingCostPaisa ?? input.costPaisa ?? 0,
        docType: 'product',
        docId: id,
        reason: 'Opening stock',
        actorName: input.actor.name,
      });
    }

    await audit(tx, { actor: input.actor, action: 'product.create', entity: 'product', entityId: id, details: { code } });
    return id;
  });
}

async function writeUnits(tx: Tx, productId: string, baseUnit: string, units: ProductUnitInput[]): Promise<void> {
  await tx.exec('DELETE FROM product_units WHERE product_id = ?', [productId]);
  const seen = new Set<string>();
  for (const u of units) {
    const key = `${u.kind}:${u.unitCode}`;
    if (seen.has(key)) {continue;}
    seen.add(key);
    const factor = Math.round(u.factorMicro);
    if (!isFactorValid(baseUnit, u.unitCode, factor)) {
      throw new ValidationError(`Conversion factor for ${u.unitCode} must be greater than zero`, 'factor');
    }
    await tx.exec(
      `INSERT INTO product_units (id, product_id, unit_code, kind, factor_micro, price_paisa, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId('pu'), productId, u.unitCode, u.kind, factor, u.pricePaisa ?? null, u.isDefault ? 1 : 0],
    );
  }
}

async function writeBarcodes(tx: Tx, productId: string, barcodes: (string | null)[], at: string): Promise<void> {
  const clean = barcodes.filter((b): b is string => !!b && b.trim().length > 0).map(b => b.trim());
  for (const barcode of clean) {
    const clash = await tx.one<{ id: string; product_id: string }>(
      'SELECT id, product_id FROM product_barcodes WHERE barcode = ?',
      [barcode],
    );
    if (clash) {
      if (clash.product_id === productId) {continue;}
      throw new ValidationError(`Barcode ${barcode} is already used`, 'barcode');
    }
    await tx.exec('INSERT INTO product_barcodes (id, product_id, barcode, created_at) VALUES (?, ?, ?, ?)', [
      newId('bc'),
      productId,
      barcode,
      at,
    ]);
  }
}

export async function updateProduct(
  db: Database,
  input: ProductInput & { id: string },
): Promise<void> {
  assertCan(input.actor.role, 'product.manage');
  await db.tx(async tx => {
    const existing = await tx.one<ProductRow>('SELECT * FROM products WHERE id = ?', [input.id]);
    if (!existing) {throw new NotFoundError('Product', input.id);}
    const code = (input.code ?? existing.code).trim();
    if (code !== existing.code) {
      const clash = await tx.one<{ id: string }>('SELECT id FROM products WHERE code = ? AND id <> ?', [
        code,
        input.id,
      ]);
      if (clash) {throw new ValidationError(`Product code ${code} already exists`, 'code');}
    }
    const blob = await buildSearchBlob(tx, {
      nameEn: input.nameEn,
      nameUr: input.nameUr,
      code,
      barcode: input.barcode,
      extraBarcodes: input.extraBarcodes,
    });
    const at = nowIso();
    await tx.exec(
      `UPDATE products SET code = ?, name_en = ?, name_ur = ?, barcode = ?, category_id = ?, brand_id = ?,
         supplier_id = ?, base_unit = ?, sale_price_paisa = ?, min_stock_micro = ?, target_stock_micro = ?,
         reorder_qty_micro = ?, track_expiry = ?, notes = ?, search_blob = ?, updated_at = ?
       WHERE id = ?`,
      [
        code,
        input.nameEn.trim(),
        input.nameUr ?? null,
        input.barcode ?? null,
        input.categoryId ?? null,
        input.brandId ?? null,
        input.supplierId ?? null,
        input.baseUnit,
        Math.round(input.salePricePaisa),
        Math.round(input.minStockMicro ?? 0),
        Math.round(input.targetStockMicro ?? 0),
        Math.round(input.reorderQtyMicro ?? 0),
        input.trackExpiry ? 1 : 0,
        input.notes ?? null,
        blob,
        at,
        input.id,
      ],
    );
    await writeUnits(tx, input.id, input.baseUnit, input.units ?? []);
    await tx.exec('DELETE FROM product_barcodes WHERE product_id = ?', [input.id]);
    await writeBarcodes(tx, input.id, [input.barcode ?? null, ...(input.extraBarcodes ?? [])], at);
    await audit(tx, { actor: input.actor, action: 'product.update', entity: 'product', entityId: input.id });
  });
}

export async function setProductActive(
  db: Database,
  input: { id: string; active: boolean; actor: Actor },
): Promise<void> {
  assertCan(input.actor.role, 'product.manage');
  await db.tx(async tx => {
    const at = nowIso();
    await tx.exec('UPDATE products SET is_active = ?, archived_at = ?, updated_at = ? WHERE id = ?', [
      input.active ? 1 : 0,
      input.active ? null : at,
      at,
      input.id,
    ]);
    await audit(tx, {
      actor: input.actor,
      action: input.active ? 'product.restore' : 'product.archive',
      entity: 'product',
      entityId: input.id,
    });
  });
}

export type StockFilter = 'all' | 'in' | 'low' | 'out';
export type ProductSort = 'name' | 'stock' | 'price' | 'recent';

export interface ProductListQuery {
  query?: string;
  categoryId?: string;
  supplierId?: string;
  stock?: StockFilter;
  includeArchived?: boolean;
  sort?: ProductSort;
  limit?: number;
  cursor?: { after: string | number | null; afterId: string | null } | null;
}

export async function listProducts(db: Database, q: ProductListQuery = {}) {
  const limit = Math.min(q.limit ?? 40, 200);
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (!q.includeArchived) {where.push('archived_at IS NULL');}
  if (q.categoryId) {where.push('category_id = ?'); params.push(q.categoryId);}
  if (q.supplierId) {where.push('supplier_id = ?'); params.push(q.supplierId);}
  if (q.stock === 'out') {where.push('stock_micro <= 0');}
  if (q.stock === 'low') {where.push('stock_micro > 0 AND stock_micro <= min_stock_micro');}
  if (q.stock === 'in') {where.push('stock_micro > 0');}
  if (q.query && q.query.trim()) {
    const pattern = likePattern(normalizeSearch(q.query));
    where.push(`(search_blob LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\'
      OR id IN (SELECT product_id FROM product_barcodes WHERE barcode LIKE ? ESCAPE '\\'))`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const sortCol =
    q.sort === 'stock' ? 'stock_micro' : q.sort === 'price' ? 'sale_price_paisa' : q.sort === 'recent' ? 'updated_at' : 'name_en';
  const ascending = q.sort === 'name' || q.sort === 'stock';
  if (q.cursor && q.cursor.after !== null && q.cursor.afterId) {
    const op = ascending ? '>' : '<';
    where.push(`(${sortCol} ${op} ? OR (${sortCol} = ? AND id ${op} ?))`);
    params.push(q.cursor.after, q.cursor.after, q.cursor.afterId);
  }
  params.push(limit);
  const rows = await db.query(
    `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${sortCol} ${ascending ? 'ASC' : 'DESC'}, id ${ascending ? 'ASC' : 'DESC'} LIMIT ?`,
    params,
  );
  return rows as unknown as ProductRow[];
}

export function nextCursor(rows: ProductRow[], sort: ProductSort = 'name') {
  if (!rows.length) {return null;}
  const last = rows[rows.length - 1];
  const after =
    sort === 'stock' ? Number(last.stock_micro) : sort === 'price' ? Number(last.sale_price_paisa) : sort === 'recent' ? last.updated_at : last.name_en;
  return { after, afterId: last.id };
}

export async function productByBarcode(db: Database, barcode: string): Promise<ProductRow | undefined> {
  const direct = await db.one<ProductRow>('SELECT * FROM products WHERE barcode = ? AND archived_at IS NULL', [
    barcode,
  ]);
  if (direct) {return direct;}
  return db.one<ProductRow>(
    `SELECT p.* FROM products p JOIN product_barcodes b ON b.product_id = p.id
     WHERE b.barcode = ? AND p.archived_at IS NULL`,
    [barcode],
  );
}

export async function productDetail(db: Database, productId: string) {
  const product = await db.one<ProductRow>('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) {throw new NotFoundError('Product', productId);}
  const units = (await db.query('SELECT * FROM product_units WHERE product_id = ? ORDER BY kind, unit_code', [
    productId,
  ])) as unknown as ProductUnitRow[];
  const barcodes = await db.query('SELECT barcode FROM product_barcodes WHERE product_id = ?', [productId]);
  const movements = await db.query(
    'SELECT * FROM stock_movements WHERE product_id = ? ORDER BY moved_at DESC, id DESC LIMIT 60',
    [productId],
  );
  const sales = await db.query(
    `SELECT s.invoice_no, s.sold_at, l.qty_micro, l.unit_code, l.line_total_paisa, l.cogs_paisa
     FROM sale_lines l JOIN sales s ON s.id = l.sale_id
     WHERE l.product_id = ? ORDER BY s.sold_at DESC LIMIT 20`,
    [productId],
  );
  const purchases = await db.query(
    `SELECT p.doc_no, p.purchased_at, l.qty_micro, l.unit_code, l.unit_cost_paisa, l.line_total_paisa
     FROM purchase_lines l JOIN purchases p ON p.id = l.purchase_id
     WHERE l.product_id = ? ORDER BY p.purchased_at DESC LIMIT 20`,
    [productId],
  );
  return { product, units, barcodes, movements, sales, purchases };
}

export async function productSaleUnits(db: Database, productId: string) {
  const rows = await db.query(
    `SELECT * FROM product_units WHERE product_id = ? AND kind = 'sale' ORDER BY factor_micro DESC`,
    [productId],
  );
  const product = await db.one<ProductRow>('SELECT * FROM products WHERE id = ?', [productId]);
  const units = rows as unknown as ProductUnitRow[];
  if (product && !units.some(u => u.unit_code === product.base_unit)) {
    units.push({
      id: 'base',
      product_id: productId,
      unit_code: product.base_unit,
      kind: 'sale',
      factor_micro: QTY_SCALE,
      price_paisa: null,
      is_default: 0,
    });
  }
  return units;
}

/** Default factor used when the UI adds a unit row. */
export async function suggestedFactor(baseUnit: string, unitCode: string): Promise<number> {
  return defaultFactorMicro(baseUnit, unitCode) ?? QTY_SCALE;
}
