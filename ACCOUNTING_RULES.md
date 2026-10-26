# Accounting rules

Everything below is implemented in `src/core/*` and `src/services/*` and asserted by the test
suite. Where a rule is a choice rather than a law of accounting, it is labelled as such.

---

## 1. Units of value

| Quantity | Unit | Precision |
| --- | --- | --- |
| Money | paisa (integer) | 2 decimals displayed, 0 lost |
| Quantity | micro base units (integer) | up to 6 decimals, display precision configurable |
| Rates | basis points (1 bp = 0.01%) | tax, discounts, margins |

All arithmetic uses `mulDivRound(value, mul, div)` from [src/core/money.ts](src/core/money.ts):
`BigInt` product, integer division that rounds **half away from zero**, then a safe-integer guard.
Consequences worth knowing:

- 500 g at PKR 150/kg = `mulDivRound(15000, 500000, 1000000)` = **7500 paisa (PKR 75)** exactly.
- A 1/3 kg sale at PKR 150/kg rounds to PKR 50.00, not 49.999… .
- Summing 1,000 lines cannot accumulate float drift, because no float is involved.
- Overflow throws (`Numeric overflow`) rather than silently wrapping.

---

## 2. Unit conversion

- A product has exactly **one base unit**; every other unit stores `factor_micro` = micro units
  of the base unit contained in 1 of that unit (1 bag = 10 kg → `10000000`).
- Canonical quantity of a line: `base_qty = mulDivRound(qty, factor, QTY_SCALE)`.
- Dimensions come from the unit catalogue (`mass`, `volume`, `count`). A factor is only
  auto-suggested when both units share a dimension; `kg → litre` is rejected and `kg → bag`
  requires an explicit product-level factor (a sugar bag is 10 kg, a rice bag is 25 kg — the app
  must not guess).
- Packaging hierarchy is unlimited through `product_units` rows: carton = 20 boxes = 120 pieces
  is two rows (carton 120, box 6) plus the implicit base unit.

## 3. Derived selling prices

```
price(unit)   = mulDivRound(baseSalePrice, factor(unit), QTY_SCALE)
rounding      = price-rounding setting (`paisa` = exact, `rupee` = nearest PKR 1, `five_rupees` = nearest PKR 5)
```

- The base price is authoritative; packaging prices are derived on every render, so a price
  change immediately shows the new bag price.
- A manager may **override** a derived price: the override is stored as
  `product_units.price_paisa` and used verbatim at the till (useful for a carton price that is
  slightly below 120 × piece price).
- Margin vs markup is labelled correctly in the UI: `margin = profit / selling price`,
  `markup = profit / cost`.

## 4. Purchase cost and valuation

- **Valuation method: weighted average cost (WAC) per base unit.** `weightedAverageCost()` keeps
  the total value and total quantity and re-derives the average, so it is exact at every step.
- Freight and other landed costs are allocated across lines **in proportion to line value** and
  added to that line's cost basis; the line's `cost_per_base_paisa` therefore reflects landed
  cost, not just the invoice price.
- An entered purchase in `bags` stores both what was typed (`qty_micro`, `unit_code`,
  `factor_micro`) and the canonical `base_qty_micro`, so a later reprint or audit is faithful.
- Recording a purchase updates the product's WAC. It does **not** change the selling price unless
  the manager explicitly asks for a price update on that purchase.
- Historical purchase prices remain in `purchase_lines`; nothing is overwritten.

## 5. Cost of goods sold and profit

At the moment a sale is posted, each line stores:

```
unit_cost_paisa = product cost (WAC) at that instant
cogs_paisa      = mulDivRound(base_qty, unit_cost_paisa, QTY_SCALE)
line_total      = gross - line_discount
```

Reports compute:

```
net sales      = SUM(sale_lines.line_total) - returns' net value
COGS           = SUM(sale_lines.cogs_paisa) - COGS of returned quantities
gross profit   = net sales - COGS
operating profit = gross profit - recorded expenses in the same range
```

Rules and exclusions, stated plainly in the UI:

- **Profit is never “sales minus today's purchases”.** Unsold purchases are inventory, not cost.
- Returns reverse COGS at the **original line cost**, not at today's cost.
- Operating profit excludes owner drawings, capital purchases, loan interest and taxes (none of
  these are modelled); the report labels it “estimated operating profit”.
- Because cost is frozen on the line, changing a product's cost or price later cannot rewrite
  last month's profit.
- A double-check in the test suite recomputes profit from movements and compares it with the
  report output.

## 6. Discounts and tax

- Line discount: fixed paisa per line, cannot exceed that line's gross.
- Bill discount: percentage (bp) **or** fixed; both may be combined but the total is capped at the
  bill subtotal, so a total can never go negative.
- A discount above the configured limit (`discount_limit_bp`) is rejected unless the actor holds
  `sale.discount.override` (or sends explicit manager approval).
- Tax is **off by default**; when a product carries `tax_bp`, tax is computed on the
  after-line-discount amount per line and summed. Tax is not applied to discounts.

## 7. Ledger sign conventions

`ledger_entries` holds `debit_paisa`, `credit_paisa` and the running `balance_paisa`.

**Customers (receivables) — balance > 0 means the customer owes the store**

| Event | Debit | Credit |
| --- | --- | --- |
| Opening receivable | amount | |
| Credit sale | total | |
| Payment received | | amount |
| Return / credit note | | value |
| Adjustment increasing debt | amount | |
| Adjustment decreasing debt | | amount |

**Suppliers (payables) — balance > 0 means the store owes the supplier**

| Event | Debit | Credit |
| --- | --- | --- |
| Opening payable | | amount |
| Credit purchase | | total |
| Payment made | amount | |
| Purchase return | amount | |
| Adjustment increasing payable | | amount |
| Adjustment decreasing payable | | amount |

Implementation: `entryDelta(partyType, debit, credit)` in [src/core/ledger.ts](src/core/ledger.ts)
— customers `debit - credit`, suppliers `credit - debit`. Balances are appended per entry
(`balance_paisa` is the running total), and `parties.balance_paisa` caches the last value inside
the same transaction. There is no UI that edits a balance directly; corrections are adjustment
entries with a reason, actor and audit record.

Reversal: a reversed document posts an **equal and opposite** ledger entry referencing the
original; it never deletes the original entry, so statements keep their history.

## 8. Payments

- A payment has a `direction` (`in` for customer receipts, `out` for supplier payments) and a
  method. `payment_methods.is_cash` decides whether it touches the drawer; `is_credit` marks a
  credit sale settlement.
- Partial payment: `sales.paid_paisa` is the sum of its payments; `credit_paisa = total - paid`
  and the difference is posted to the customer ledger.
- Split payment: one `payments` row per method, each with its own amount; the sum must equal the
  paid amount, and the test suite asserts split payments reconcile to the bill total exactly.
- Walk-in (no customer) sales must be fully paid at the till by policy; anonymous credit is
  refused.
- Credit limit: if a customer has `credit_limit_paisa`, a sale that would exceed it is refused
  unless the actor is a manager/owner.
- A payment can be recorded against an existing balance without creating a new sale.

## 9. Cash drawer and cash closing

```
expected cash = opening cash
              + cash in  (cash sales, customer cash receipts, owner deposits, other cash in)
              - cash out (cash purchases, supplier cash payments, cash expenses,
                          cash refunds, owner withdrawals, other cash out)
```

- Only movements whose method `is_cash = 1` create `cash_movements`; a bank transfer, card or
  wallet payment **never** affects drawer cash (asserted in tests).
- Closing records `counted_cash_paisa` and `difference_paisa = counted - expected`. A difference is
  recorded, never silently absorbed into the ledger.
- A closed shift is immutable: corrections are new audited movements, not edits to a closed row.
- `cash_movements.shift_id` ties every movement to its shift, so a day or shift can be reconciled
  independently.

## 10. Returns and exchanges

- A return references the original document and line, and cannot exceed
  `sold qty - already returned qty` (`sale_lines.returned_qty_micro`).
- Restocked goods go back into stock at the **original unit cost**; damaged goods are recorded with
  `damage_qty_micro` and are *not* added back to sellable stock.
- Refund value uses the original selling price, so a price change after the sale cannot inflate a
  refund.
- Ledger effect: a customer return posts a credit (reduces receivable) or a cash refund movement;
  a supplier return posts a debit (reduces payable).
- An exchange is a return document plus a new sale document, linked through the return; the
  original invoice is never edited.

## 11. Stock adjustments

- Every adjustment has a type (`receipt`, `opening`, `count`, `damage`, `wastage`, `found`,
  `correction`, `supplier_return`), a **required reason**, an actor and a timestamp.
- Stock arriving with a cost that creates a payable must be entered as a purchase (or a receipt
  explicitly linked to a supplier); the app never creates stock and supplier debt inconsistently.
- A physical count stores both `system_qty_micro` and `counted_qty_micro`, so the difference and its
  financial impact can be reported later.
- Cost of a positive adjustment: the manager supplies the unit cost (defaulting to current WAC for
  found stock), which feeds the WAC calculation.

## 12. Rounding summary

| Operation | Rule |
| --- | --- |
| Unit price × quantity | half away from zero, to paisa |
| Percentage (bp) amounts | half away from zero, to paisa |
| Derived unit price | half away from zero, then optional price-rounding rule |
| Average cost | half away from zero, to paisa per base unit |
| Freight allocation | proportional by line value, remainder to the largest line |
| Display | 2 decimals for money, configurable decimals for quantity |

Rounding never happens on stored totals: a bill's `total_paisa` is the sum of already-rounded
components, so the printed bill and the database always agree to the paisa.
