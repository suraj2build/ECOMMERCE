# P1 console: information architecture and permission map

The console (`apps/admin`, port 3001) shows a navigation item when the
staff session holds any of the listed permissions (`apps/admin/src/lib/nav.ts`).
Hiding is a convenience only: every read and every action is authorized by
the API, and a refusal is shown with the server's own message. Action
buttons are shown to holders of the action's permission; which transition
is legal from the current state is left to the server (the console does
not hide or compute transitions).

Roles below are the seeded defaults (`packages/db/prisma/seed.ts`);
SUPER_ADMIN holds everything.

## Navigation

| Group | Screen | Route | Shown when the session holds |
|---|---|---|---|
| Dashboard | Overview | `/dashboard` | any staff |
| Merchandise | Products | `/dashboard/products`, `/new`, `/[id]` | `product:read` |
| | Collections | `/dashboard/collections`, `/[id]` | `product:read` |
| Procurement | Suppliers | `/dashboard/suppliers`, `/[id]` | `supplier:read` |
| | Purchase orders | `/dashboard/purchase-orders`, `/new`, `/[id]` | `po:read` |
| | Goods receiving | `/dashboard/receiving` | `grn:read` or `grn:create` |
| Inventory | Stock | `/dashboard/inventory` | `inventory:read` |
| | Adjustments | `/dashboard/inventory-adjustments` | `inventory:adjust` |
| | Transfers | `/dashboard/inventory/transfers` | `inventory:read` or `inventory:transfer` |
| | Reconciliation | `/dashboard/inventory/reconcile` | `inventory:read` |
| Orders | Orders | `/dashboard/orders`, `/[id]` | `order:read` |
| | Pick queue | `/dashboard/warehouse/picks` | `warehouse:read` |
| | Pack & ship | `/dashboard/fulfilments` | `order:read` |
| Post-purchase | Returns | `/dashboard/returns`, `/[id]` | `return:read` |
| | Exchanges | `/dashboard/exchanges`, `/[id]` | `exchange:read` |
| | Refunds | `/dashboard/refunds` | `payment:refund` |
| Commercial | Promotions | `/dashboard/promotions`, `/new` | `promotion:read` |
| | Gift cards | `/dashboard/gift-cards`, `/[id]` | `giftcard:read` |
| | Channels | `/dashboard/channels` | `channel:read` |
| | Loyalty tools | `/dashboard/loyalty` | `loyalty:adjust` |
| Customers | Customer 360 | `/dashboard/customer-360` | `customer_service:manage` |
| Content | Banners, Content blocks, Landing pages, Navigation menus | `/dashboard/cms/*` | `cms:read` |
| Insights | Analytics | `/dashboard/analytics` | `analytics:read` |

## Actions → API → permission

| Screen | Action | API route | Permission |
|---|---|---|---|
| Login | Sign in (+ MFA code when the server answers `MFA_REQUIRED`) | `POST /auth/staff/login`, `GET /auth/staff/me` | — |
| Shell | Sign out (revokes the session server-side) | `POST /auth/staff/logout` | staff session |
| Products | Create style | `POST /products/styles` | `product:write` |
| | Add colour / generate SKU matrix / add media | `POST /products/styles/:id/colours`, `/skus/generate`, `/media` | `product:write` |
| | Ready for enrichment / QA check / archive | `POST /products/styles/:id/ready-for-enrichment`, `/qa-check`, `/archive` | `product:write` |
| | Publish / unpublish | `POST /products/styles/:id/publish`, `/unpublish` | `product:publish` |
| | Base price / markdown | `POST /catalog/prices`, `/catalog/prices/markdown` | `catalog:price:write` (+ `catalog:price:approve` for markdown) |
| | Add / remove badge | `POST /catalog/badges`, `DELETE /catalog/badges/:id` | `catalog:collection:manage` |
| Collections | Create / add style / remove style | `POST /catalog/collections`, `POST /catalog/collections/:id/styles`, `DELETE …/styles/:styleId` | `catalog:collection:manage` |
| | Publish / unpublish | `POST /catalog/collections/:id/publish`, `/unpublish` | `catalog:publish` |
| Suppliers | Create / deactivate / link SKU cost | `POST /suppliers`, `/suppliers/:id/deactivate`, `/suppliers/sku-links` | `supplier:write` |
| Purchase orders | Create draft / cancel | `POST /procurement/purchase-orders`, `/:id/cancel` | `po:create` |
| | Submit | `POST /procurement/purchase-orders/:id/submit` | `po:submit` |
| | Approve / reject (different person from the submitter; server-enforced) | `POST …/:id/approve`, `/reject` | `po:approve` |
| | Record goods receipt with QC | `POST /grn` | `grn:create` (+ a sign-off holder of `grn:qc:manager_signoff` at the threshold) |
| Inventory | Adjustment (co-approver above threshold) | `POST /inventory/adjustments` | `inventory:adjust` (+ co-approver holding `inventory:adjust:coapprove`) |
| | Balance / reconcile | `GET /inventory/balance`, `GET /inventory/reconcile` | `inventory:read` |
| | Send / receive transfer | `POST /inventory/transfers/out`, `/inventory/transfers/:id/in` | `inventory:transfer` |
| Orders | Create fulfilment / pack / ready to ship / manual ship / deliver | `POST /orders/:id/fulfilments`, `/orders/fulfilments/:id/pack`, `/ready-to-ship`, `/ship`, `/deliver` | `order:fulfil` |
| | Book shipment with carrier / poll tracking | `POST /orders/fulfilments/:id/shipment`, `POST /shipments/poll` | `shipping:manage` |
| | Cancel line | `POST /orders/:id/lines/:lineId/cancel` | `order:cancel` |
| | Flag / resolve exception | `POST …/lines/:lineId/exception`, `/exception/resolve` | `order:exception:manage` |
| | Mark RTO | `POST /orders/:id/rto` | `order:rto` |
| | Retry invoice | `POST /orders/:id/retry-invoice` | `invoice:create` |
| Pick queue | Record pick (full / short / exception) | `POST /warehouse/pick-tasks/:id/pick` | `warehouse:pick` |
| Returns | Start return | `POST /returns` | `return:initiate` |
| | Schedule pickup / picked up / received | `POST /returns/:id/pickup`, `/pickup/complete`, `/receive` | `return:receive` |
| | QC + disposition | `POST /returns/:id/lines/:lineId/qc` | `return:qc` |
| | Cancel | `POST /returns/:id/cancel` | `return:initiate` |
| | View evidence | `GET /returns/:id/lines/:lineId/evidence[/:id]` | `return:read` |
| Exchanges | Request | `POST /exchanges` | `exchange:initiate` |
| | Pickup / picked up / received | `POST /exchanges/:id/pickup`, `/pickup/complete`, `/receive` | `exchange:receive` |
| | QC | `POST /exchanges/:id/qc` | `exchange:qc` |
| | Replacement package / out-of-pipeline completion (recovery only) | `POST /exchanges/:id/fulfilment`, `/replacement-fulfilled` | `exchange:fulfil` |
| Refunds | Issue / retry / reconcile sweep | `POST /refunds`, `/refunds/:id/retry`, `/refunds/reconcile` | `payment:refund` |
| Promotions | Create / activate / deactivate | `POST /promotions`, `PATCH /promotions/:id/active` | `promotion:manage` |
| Gift cards | Issue / adjust / disable / release stale holds | `POST /gift-cards/issue`, `/:id/adjust`, `/:id/disable`, `/sweep/release-stale-holds` | `giftcard:manage` |
| Channels | Create channel / publish / unpublish / reclaim / resync | `POST /channels`, `/channels/:id/skus/:skuId/publish`, `/unpublish`, `/channels/sweep/*` | `channel:manage` |
| Loyalty tools | Find customer (exact mobile; identity and points only), manual adjustment (refused below zero) | `GET /loyalty/customers/lookup`, `POST /loyalty/adjust` | `loyalty:adjust` (D-1, D-3) |
| | Vest / expire / release-hold sweeps (type RUN to confirm) | `POST /loyalty/sweep/vest`, `/expire`, `/release-stale-holds` | `loyalty:adjust` |
| Customer 360 | Look up by exact mobile | `GET /support/customers/lookup`, `/support/customers/:id/360` | `customer_service:manage` |
| CMS | Existing M29 actions | `/cms/*` | `cms:manage` / `cms:read` |
| Analytics | Reports | `GET /analytics/commerce`, `/fashion`, `/procurement` | `analytics:read` |

## Confirmation levels

- **Confirm dialog**: style publish/unpublish/archive; PO submit,
  approve, reject and cancel; supplier deactivation; inventory
  adjustments; transfer receipt; every fulfilment step and carrier
  booking; line cancellation, exception flag/resolve, RTO, invoice retry;
  return and exchange steps and QC; refund issue and retry; promotion
  activate/deactivate; gift-card adjust, disable and hold release;
  channel publish/unpublish and sweeps; loyalty adjustment.
- **Direct submit** (the form itself is the confirmation; the server
  validates it): creating a style, colour, SKU matrix, media, price,
  badge, collection, supplier, SKU cost link, PO draft, goods receipt,
  transfer, pick outcome, promotion or gift card; ready-for-enrichment
  and the QA check;
  collection publish/unpublish.
- **Type-to-confirm** (`RUN` / `CONFIRM`): loyalty sweeps, the refund
  reconcile sweep (it processes every qualifying unrefunded line), and
  the exchange out-of-pipeline completion.
- **Idempotency keys**: generated once per dialog opening and reused if
  the operator retries, for every route that takes one (shipments, picks,
  returns, exchanges, refunds, gift-card issue/adjust, loyalty adjust,
  line cancellation).
