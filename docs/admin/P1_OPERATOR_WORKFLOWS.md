# P1 console: operator workflows

How each staff job runs through the console. Every step posts to the
owning domain's existing route; the server validates and performs the
transition, and the console shows the state it returns. The P1 Playwright
flow that proves each workflow end to end is named in brackets
(`test/e2e-admin/p1-console.spec.ts`).

## Merchandising: new style to sellable [P1-01]

1. Products → New style: code, name, brand, category, season, collection
   (+ optional attributes). The style starts in DRAFT.
2. Workbench → Colours & SKUs: add each colour, tick the sizes you stock,
   Generate SKUs (every colour × chosen size; existing SKUs kept).
3. Media: add image URLs (the console lists URLs; it does not load
   third-party images).
4. Lifecycle: Mark ready for enrichment → Run QA check (the service lists
   what is missing if it fails) → Publish.
5. Pricing: set MRP and selling price (a markdown also needs dates and
   `catalog:price:approve`). "Sellable on storefront" turns Yes once the
   style is published and priced.

## Buying: supplier to received stock [P1-02]

1. Suppliers → New supplier; open it to link SKUs with their unit cost.
2. Purchase orders → New: pick the supplier and delivery location, add
   lines by SKU code, save the draft, then Submit for approval.
3. Finance opens the PO (SKU codes are shown even without product access)
   and approves or rejects it. The server refuses an approval by the
   person who submitted it.
4. Warehouse → Goods receiving → open the PO → enter received, accepted,
   damaged and rejected quantities per line (+ QC notes). A manager
   sign-off is chosen when failed units reach the threshold. The GRN
   service posts accepted units as sellable stock and failed units as
   damaged, and reports short/excess lines.

## Inventory control [P1-03, P1-04]

- Stock: search by SKU or style; each row shows on hand, reserved,
  available (the inventory service's own figure), damaged, return-pending
  and in-transit.
- Adjust (from a stock row or Adjustments): pick SKU and location, see the
  current balance, enter a signed quantity and justification, confirm.
  Above the threshold the server requires a Finance co-approver.
- Transfers: send stock from one location to another (it shows as in
  transit), then Receive it at the destination.
- Reconciliation: compares a stored balance with a replay of its ledger
  (see decision D-4 on how adjustments affect this check).

Manual reservation controls are not exposed.

## Fulfilment [P1-05, P1-06]

1. Pick queue (filter by location): Record pick → full, short or
   exception. Short/exception picks write off stock through the warehouse
   service and may need a co-approver.
2. Order page: select picked lines → Create fulfilment (a package).
3. Package: Mark packed → Ready to ship → Book shipment with carrier
   (production refuses the MOCK carrier) or Mark shipped manually →
   delivery normally arrives from the carrier; Mark delivered is the
   manual path.
4. Pack & ship lists every package by status, order- and exchange-sourced.

## Returns and refunds [P1-07]

1. Customer service starts a return from the order (select lines, reason,
   drop-off or pickup). The return service checks the window.
2. Warehouse: schedule pickup / picked up (pickup method) → Mark received
   → Record QC and disposition per line. A pass makes the line
   refund-eligible; the disposition decides where the unit goes in stock.
3. Finance: Refund on the order line (or Issue refund on the return). The
   refund service decides eligibility, amount and method (original
   payment for prepaid, store credit for COD). Refunds lists every refund
   with retry for failed ones and the reconcile sweep.

## Exchanges [P1-08]

1. Customer service: Exchange on an order line, choosing the replacement
   SKU. The exchange service works out the price difference and
   settlement direction.
2. Warehouse: receive the original (after pickup if chosen) → Record QC.
   On a pass the service settles the difference and allocates the
   replacement, which creates a pick task.
3. The replacement is picked from the normal pick queue, then Create
   replacement package → pack → ready to ship → ship → deliver on the
   exchange page. Delivery completes the exchange automatically. No
   second order or order line is ever created. "Confirm fulfilled outside
   the pipeline" is a type-to-confirm recovery path only.

## Commercial [P1-09, P1-11]

- Promotions: create (automatic or coupon; discount, window, limits,
  stack group, loyalty/store-credit compatibility), then activate or
  deactivate. Checkout alone decides eligibility and stacking.
- Gift cards: Issue shows the code once (give it to the recipient then;
  it cannot be retrieved). Find cards by last four or status; open one to
  see its ledger, adjust the balance (never below zero) or disable it.
- Channels: pick a channel, preview a SKU's feed item, publish, unpublish;
  inspect attempts. An ambiguous outcome stays flagged until an operator
  re-issues the same action.

## Customer care and loyalty [P1-10]

- Customer 360: exact-mobile lookup only; shows summary counts, balances
  and recent orders, never addresses, browsing history or saved sizes.
- Loyalty tools: from a customer, add or remove points with a reason.
  The vest, expire and release-hold sweeps run the loyalty service's own
  rules (LOY-006: points vest only after delivery and the close of the
  return/exchange window, with no open return or exchange) and need RUN
  typed to confirm.

## Insights [P1-12]

Analytics shows the analytics service's numbers as returned, including
zero, negative and missing values; ids are shown as names only where the
viewer may read that entity.
