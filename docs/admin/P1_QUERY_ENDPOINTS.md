# P1 console read endpoints (`/api/v1/admin/*`)

Status: added by the P1 Commerce Operations Console build (2026-09-30,
baseline `b0237d1`). Code: `services/commerce-api/src/modules/admin-queries/`.
Tests: `services/commerce-api/test/integration/admin-queries.test.ts`.

## Rules every endpoint here follows

- **Read-only.** No endpoint writes, transitions state or calls another
  service's mutating method. Every mutation the console performs goes to
  the owning domain's existing route.
- **No duplicated business logic.** Each endpoint is a projection of rows
  an existing domain already owns. The one derived figure, stock
  `available`, calls the inventory service's own `availableAtLocation`
  (extracted from `InventoryService.getBalance`, output-preserving) so the
  list and the per-SKU balance use a single definition.
- **Same permission as the underlying data.** Each endpoint is gated by the
  permission that already guards that data elsewhere. A denial returns 403
  and writes the same `authz.denied` audit row as `requirePermission`.
- **Bounded.** Lookups return at most 25 rows; pages at most 100
  (`boundedTake`). Nothing loads a whole table into the browser.
- **Minimal fields.** Staff pickers return identity only (id, full name).
  Order search omits contact details (they stay on `GET /orders/:id`).
  Gift-card lists never contain the code or its hash.
- **Tested** unauthenticated (401), without the permission (403 + audit
  row), and authorized with data built through the real domain APIs.

## Endpoints

| Endpoint | Permission | Why it exists |
|---|---|---|
| `GET /admin/lookup/skus?q=` | `product:read` | Find a SKU by SKU code, barcode, style code or style name. Replaces typing SKU UUIDs into adjustment, PO, transfer, exchange and channel forms. |
| `GET /admin/lookup/styles?q=` | `product:read` | Style picker for collections. |
| `GET /admin/lookup/suppliers?q=` | `supplier:read` | Supplier picker for purchase orders. |
| `GET /admin/lookup/staff?capability=` | the action the picker serves: `inventory:adjust` (inventory co-approver), `grn:create` (GRN QC sign-off), `warehouse:pick` (pick-shortfall co-approver) | Lists active staff who hold the approving permission (`inventory:adjust:coapprove` / `grn:qc:manager_signoff`), excluding the caller. The owning route still re-checks the chosen person's permission on submit. |
| `GET /admin/lookup/labels?styleIds=&skuIds=&colourIds=&sizeIds=&supplierIds=&locationIds=&orderIds=&purchaseOrderIds=` | per group: product ids `product:read`; `supplierIds` `supplier:read`; `orderIds` `order:read`; `purchaseOrderIds` `po:read`; `locationIds` any staff (locations are already listed to any staff by `GET /organization/locations`) | id → display label for screens whose source API returns bare ids (analytics, return/exchange queues, channel listings). Max 200 ids per group. |
| `GET /admin/products/styles` | `product:read` | Paginated, searchable style list with brand/category names and colour/SKU/media counts. `GET /products/styles` returns bare rows without names or totals. |
| `GET /admin/purchase-orders` | `po:read` | Paginated PO list with supplier/location names, search by PO number or supplier, and a total. |
| `GET /admin/purchase-orders/:id/lines` | `po:read` | PO lines with SKU descriptions and approver names. An approver (Finance: `po:read`, no `product:read`) otherwise sees only SKU and staff UUIDs on what they approve. |
| `GET /admin/suppliers` | `supplier:read` | Bounded supplier directory with SKU-link and PO counts. `GET /suppliers` returns every row. |
| `GET /admin/suppliers/:id/sku-links` | `supplier:read` | Supplier SKU cost links were writable (`POST /suppliers/sku-links`) but had no read route. |
| `GET /admin/inventory/stock` | `inventory:read` | Stock positions across SKUs and locations with search. `GET /inventory/balance` answers one SKU at one location only. |
| `GET /admin/inventory/transfers` | `inventory:read` | Transfer list; there was no way to find an in-transit transfer to receive it. |
| `GET /admin/orders` | `order:read` | Order search by order number with status/invoice filters. `GET /orders` has no search. |
| `GET /admin/fulfilments` | `order:read` | Pack & ship queue across order- and exchange-sourced packages, with shipment status. |
| `GET /admin/refunds` | `payment:refund` | Refund queue by status (there was only per-order and per-id read). |
| `GET /admin/gift-cards?status=&last4=` | `giftcard:read` | Find a card by status or the last four characters of its code. Never returns the code or `codeHash`. |
| `GET /admin/promotion-types` | `promotion:read` | The reference table whose `key` `POST /promotions` requires. |
| `GET /admin/catalog/collections`, `GET /admin/catalog/collections/:id` | `product:read` | Collections including unpublished ones, with their styles. The storefront route lists published collections only. |
| `GET /admin/dashboard/workload` | any staff; each section computed only if the caller holds its permission (`order:read`, `warehouse:read`, `po:read`, `inventory:read`, `return:read`, `exchange:read`, `payment:refund`) | Plain status counts for the overview tiles. |

## Existing endpoints the console uses unchanged

The console's writes and most detail reads go to the existing routes of
each domain (product, catalog, supplier, procurement, grn, inventory,
order, warehouse, shipping, returns, exchanges, refunds, promotions,
gift-cards, loyalty, channels, support, cms, analytics, organization).
See `docs/admin/P1_PERMISSION_MAP.md` for the per-screen list.

Pre-existing list routes that are not bounded, used as-is (not changed by
P1, which does not alter certified routes without a defect): `GET
/promotions`, `GET /channels`, `GET /channels/:id/listings`, `GET
/organization/brands`, `GET /organization/locations`, `GET
/storefront/categories`, `GET /storefront/sizes`. The last four are small
reference tables. `GET /returns` and `GET /exchanges` are capped at 100 by
their services; the console says so when the cap is reached.
