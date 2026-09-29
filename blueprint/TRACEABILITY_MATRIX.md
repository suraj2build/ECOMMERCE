# Traceability Matrix (M33 Full System E2E + Production-Readiness)

Requirement → milestone → implementation → proof → gate, at milestone
granularity (not overbuilt to every individual acceptance checkbox -
each row's "Proof" column names the concrete test file(s)/count that
back every checkbox in that milestone's own `acceptance/mNN-*.md`,
which remains the authoritative per-checkbox record). "Gate" reflects
this project's own actual review discipline: no milestone in this
codebase's history has ever been self-declared certified by the
engineering agent that built it - `ENGINEERING_CERTIFIED` here means an
**independent** reviewer or the human project owner recorded that
status; `AWAITING_REVIEW` means implemented but not yet independently
reviewed.

| Milestone | Spec(s) | Key implementation | Proof | Gate |
|---|---|---|---|---|
| M00 Foundation | `specs/00` | monorepo, Docker Compose, CI, `packages/db`/`config`/`shared` | migration-from-zero, CI green | `PHASE_1_CERTIFIED` (240debc) |
| M01 Auth/RBAC | `specs/01` | `modules/auth`, `plugins/auth.ts`, RBAC matrix | `auth.test.ts`, RBAC coverage across every module | `PHASE_1_CERTIFIED` |
| M02 Product Master | `specs/02` | Style/Colour/Size/SKU hierarchy | `product.test.ts` | `PHASE_1_CERTIFIED` |
| M03 Suppliers | `specs/03` | `modules/supplier` | `supplier.test.ts` | `PHASE_1_CERTIFIED` |
| M04 Purchase Orders | `specs/04` | `modules/procurement` | `procurement.test.ts` | `PHASE_1_CERTIFIED` |
| M05 GRN/QC | `specs/05` | `modules/grn` | `grn.test.ts` | `PHASE_1_CERTIFIED` |
| M06 Inventory ledger | `specs/06` | `modules/inventory`, reservation/oversell locking | `inventory-concurrency.test.ts` (100-way), `inventory-adversarial.test.ts` | `PHASE_1_CERTIFIED` |
| M07 Catalog/Pricing | `specs/07` | `modules/catalog` | `catalog.test.ts` | `PHASE_1_CERTIFIED` |
| M08 Tax/Invoicing | `specs/32` | `modules/tax`, `InvoiceService` | `tax.test.ts`, `invoice.test.ts` | `PHASE_2_CERTIFIED` (e114399) |
| M09 Storefront foundation | `specs/08` | `apps/storefront` | E2E storefront smoke | `PHASE_2_CERTIFIED` |
| M10 Search/Discovery | `specs/09` | `modules/search`, Meilisearch | `search-discovery.test.ts` (13 tests, now ALL genuinely exercised - see `performance/SEARCH_REVIEW.md`) | `PHASE_2_CERTIFIED` |
| M11 PDP | `specs/10` | `modules/pdp` | `pdp.test.ts` | `PHASE_2_CERTIFIED` |
| M12 Wishlist/Cart | `specs/11` | `modules/cart` | `cart.test.ts` | `PHASE_2_CERTIFIED` |
| M13 Checkout | `specs/12` | `modules/checkout` | `checkout.test.ts` | `PHASE_2_CERTIFIED` |
| M14 Payment | `specs/13` | `modules/payment`, `RazorpayPaymentProvider` | `payment.test.ts`, capture/expiry reconciliation | `PHASE_2_CERTIFIED` |
| M15 Order Management | `specs/14` | `modules/order` | `order.test.ts` (32 tests) | `PHASE_2_CERTIFIED` |
| M16 Warehouse/Fulfilment | `specs/15` | `modules/warehouse` | `warehouse.test.ts` | `M16_ENGINEERING_CERTIFIED` (97c575c) |
| M17 Shipping/Tracking | `specs/16` | `modules/shipping`, `ShippingProvider` | `shipping.test.ts` | `M17_ENGINEERING_CERTIFIED` (6e28e2b) |
| M18 Cancellation | `specs/17` | `OrderService.cancelOrderLine` | `cancellation.test.ts` (30-point matrix) | `M18_ENGINEERING_CERTIFIED` (4a616b3) |
| M19 Returns | `specs/18` | `modules/returns`, evidence upload | `returns.test.ts` (43 tests) | `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` (13876a5) |
| M20 Refunds/Store Credit | `specs/19` | `modules/refunds`, `StoreCreditAccount` | `refunds.test.ts` (23 tests) | `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` |
| M21 Exchanges | `specs/20` | `modules/exchanges`, EXC-004 fulfilment integration | `exchanges.test.ts` (22 tests), `exchange-fulfilment.test.ts` (16-point matrix), `exchange-fulfilment-xor-race.test.ts` (3 tests, M32 timeout-budget repair applied) | `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` |
| M22 Customer 360 | `specs/21` | `modules/customer-profile` | `customer-profile.test.ts` (38 tests) | `M22_ENGINEERING_CERTIFIED` (1374294) |
| M23 Loyalty | `specs/22` | `modules/loyalty`, vesting lifecycle | `loyalty.test.ts` (25 tests) | AWAITING_REVIEW (vesting repair, 5bf2fb8 baseline) |
| M24 Promotions | `specs/23` | `modules/promotions` | `promotions.test.ts` | AWAITING_REVIEW |
| M25 Marketing | `specs/24` | `modules/marketing`, `MarketingProvider` | `marketing.test.ts` (27 tests) | AWAITING_REVIEW |
| M26 Channel Publishing | `specs/25` | `modules/channels`, `ChannelProvider` | `channels.test.ts` (33 tests) | `M26 INDEPENDENT-REVIEW REPAIR COMPLETE`, AWAITING_RE-REVIEW |
| M27 SEO | `specs/26` | sitemap/robots/JSON-LD/canonical | `seo.test.ts`, Playwright | AWAITING_REVIEW (preserved by M26 repair) |
| M28 Analytics | `specs/27` | `modules/analytics` | `analytics.test.ts` (9 tests) | AWAITING_REVIEW |
| M29 Admin/CMS | `specs/28`,`29` | `modules/cms`, `modules/support`, `apps/admin`, `authz.denied` audit | `cms.test.ts`, `support.test.ts`, FLOW 19/20 | AWAITING_REVIEW |
| M30 Gift Cards | `specs/33` | `modules/gift-cards` | `gift-cards.test.ts` | AWAITING_REVIEW (this phase) |
| M31 Security Hardening | cross-cutting | CART-004, rate limiting, MFA encryption, provider guards, XSS fix, N+1 auth audit | `cart-identity.test.ts`, `rate-limiting.test.ts`, `mfa-secret-crypto.test.ts`, `provider-production-guards.test.ts`, `security/*.md` | AWAITING_REVIEW (this phase) |
| M32 Performance/Scale | `acceptance/m32` | N+1 fixes, benchmarking, concurrency re-run | `performance/*.md` (this phase's own new docs) | AWAITING_REVIEW (this phase) |
| M33 Full E2E + Readiness | `acceptance/m33` | this document + golden/failure journeys + migration-from-zero + observability + backup/restore + deployment docs | this pass's own final validation run (see final report) | AWAITING_REVIEW (this phase) |

## Cross-cutting requirement traceability

| Requirement | Where enforced | Proof |
|---|---|---|
| No overselling (INV-003) | `InventoryService` row-lock reservation | `inventory-concurrency.test.ts` 100-way, re-run clean this pass |
| RBAC completeness (11 roles) | `plugins/auth.ts` `requirePermission`, `authz.denied` audit (M29) | RBAC assertions across every module's own test file |
| IDOR/BOLA protection | every storefront/customer/staff route scopes by authenticated identity | `security/AUTHORIZATION_SWEEP.md`, cross-customer IDOR tests in every M19-M30 test file |
| Financial-ledger auditability | `AuditLog` on every mutation | per-module audit assertions |
| No fabricated GST/HSN/compliance claims | `blueprint/DECISION_REGISTER.md` `TAX-001`-`006` remain `UNDER_REVIEW` | never marked DECIDED without qualified review |
| Rate limiting / abuse control (M31) | `plugins/rate-limit.ts` | `rate-limiting.test.ts` |
| PII minimization/masking | `security/PII_DATA_INVENTORY.md`, M22 audit-payload repair | `customer-profile.test.ts` PII-absence tests |
| Correlation IDs (M33) | `app.ts` `genReqId`/`onSend` (this pass) | manual verification, `order.test.ts` re-run clean |
| Migration-from-zero, zero drift | every milestone's own validation + this pass's own final run | `prisma migrate diff --exit-code` |

## What this matrix deliberately does not claim

This matrix traces what exists and what proves it - it does not itself
grant `ENGINEERING_CERTIFIED`/`VERIFIED` status to any AWAITING_REVIEW
row; that determination belongs to independent/human review, per this
project's own binding discipline (`CLAUDE.md` §7, `AGENTS.md`). See the
final report for this pass's own explicit "no self-certification"
statement.
