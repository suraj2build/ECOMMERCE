# Operating Roles (Admin / Operations Personas)

**Status (updated 2026-09-22): ADOPTED.** These roles were originally
**candidates** surfaced by analyzing the domain list in `PRODUCT.md`
and `/specs`. The Product Owner explicitly delegated finalizing the
RBAC model to the Principal Engineering Agent (§25 of the 2026-09-22
decision session: "Finalize a sensible RBAC model based on these
operating responsibilities"). Acting on that delegation, this
candidate list — **Super Admin, Business Admin, Buying, Merchandising,
Catalog, Warehouse Manager, Warehouse Operator, Customer Service,
Marketing, Finance, Analytics** — was adopted as-is, as **eleven
distinct roles** (Merchandising and Catalog kept separate, not merged
— see the note under each role below). This is recorded as `ADM-001`
`DECIDED` in `blueprint/DECISION_REGISTER.md` and normatively required
in `specs/01-auth-rbac.md` and `specs/28-admin.md`. It remains a
documented default, not a frozen commitment — the Product Owner may
revise it at any time.

For each candidate role: responsibilities, likely screens, likely
permissions, high-risk actions, and approval requirements (where a
high-risk action should require a second approver or explicit
confirmation, per the pattern in `SECURITY.md`).

## Super Admin

- **Responsibilities:** Full platform configuration, RBAC role
  management, top-level oversight.
- **Likely screens:** All admin screens; user/role management.
- **Likely permissions:** Unrestricted within the admin application
  (never extends to `SECURITY.md`'s production/destructive-operation
  boundary, which always requires human approval regardless of role).
- **High-risk actions:** Creating/modifying other admin accounts and
  roles; changing platform-wide configuration.
- **Approval requirements:** None within the platform (this is the
  top of the internal hierarchy), but production-affecting actions
  still fall under `SECURITY.md`'s human-approval rule regardless of
  role.

## Business Admin

- **Responsibilities:** Day-to-day business oversight across
  merchandising, operations, and finance dashboards; likely does not
  need Super Admin's RBAC-management powers.
- **Likely screens:** Analytics/reporting (`27`), cross-domain
  dashboards.
- **Likely permissions:** Read-heavy across most domains; write access
  scoped to business-policy configuration (e.g., promotion approval).
- **High-risk actions:** Approving large promotions or price changes.
- **Approval requirements:** May itself serve as the second approver
  for thresholds set in `PO-001`/other approval-gated decisions.

## Buyer

- **Responsibilities:** Supplier relationship management, PO creation.
- **Likely screens:** `specs/03-suppliers-procurement.md`,
  `specs/04-purchase-orders.md` screens.
- **Likely permissions:** Create/edit POs (own drafts); cannot approve
  own POs above the threshold set in `PO-001`.
- **High-risk actions:** Submitting a PO for approval; committing
  spend.
- **Approval requirements:** Per `PO-001` — value-based threshold may
  require Business Admin or Finance sign-off.

## Merchandiser

- **Responsibilities:** Catalog curation, pricing, collections,
  merchandising badges (`CAT-004`), publish/unpublish decisions
  (`CAT-002`).
- **Likely screens:** `specs/07-catalog-merchandising.md` screens.
- **Likely permissions:** Read/write catalog and pricing data; cannot
  edit core product-master attributes (that's the Catalog role, below)
  — **DECIDED (2026-09-22): Merchandising and Catalog are kept as two
  separate roles**, matching the Product Owner's adopted role list
  verbatim.
- **High-risk actions:** Price changes at scale (`PROD-006` bulk
  operations); publishing a product before enrichment is complete
  (`PROD-003`).
- **Approval requirements:** Bulk price changes above a configurable
  value threshold require Business Admin approval (engineering
  default, consistent with the general approval-threshold pattern in
  `specs/28-admin.md` `ADM-001`).

## Catalog

- **Responsibilities:** Product master data quality, attribute
  taxonomy stewardship (`PROD-001`), enrichment workflow ownership.
- **Likely screens:** `specs/02-product-master.md` screens.
- **Likely permissions:** Full read/write on product master. **DECIDED
  (2026-09-22): kept as a role distinct from Merchandising** — the
  Product Owner's adopted role list names both separately (§25), so
  this document's original merge question is resolved in favor of two
  roles, not one.
- **High-risk actions:** Modifying the attribute taxonomy itself
  (adding/removing attributes affects every product).
- **Approval requirements:** Taxonomy changes may warrant review given
  their platform-wide blast radius.

## Warehouse Manager

- **Responsibilities:** GRN oversight, QC policy enforcement, pick/pack
  operations oversight, manual inventory adjustment authorization
  (`ADM-003`).
- **Likely screens:** `specs/05-grn.md`, `specs/06-inventory.md`,
  `specs/15-warehouse-fulfilment.md` screens.
- **Likely permissions:** Full read/write on inventory and warehouse
  operations at their assigned location(s) (relevant if `ORG-002`
  chooses multi-location).
- **High-risk actions:** Manual inventory adjustments (`ADM-003`);
  QC-fail disposition decisions (`INV-006`).
- **Approval requirements:** **DECIDED** (`ADM-003`) — manual
  adjustments require a mandatory justification field and Warehouse
  Manager (or above) role; Finance co-approval is required above a
  configurable value threshold.

## Warehouse Operator

- **Responsibilities:** Day-to-day picking, packing, GRN execution
  (not policy-setting).
- **Likely screens:** Pick lists, pack confirmation, GRN receipt entry.
- **Likely permissions:** Execute assigned tasks; cannot post manual
  adjustments or change QC policy.
- **High-risk actions:** None inherently — this role is intentionally
  execution-scoped.
- **Approval requirements:** N/A.

## Customer Service

- **Responsibilities:** Order support, cancellations (`CAN-002`),
  return/refund assistance (`RET-003`), customer profile support
  view (`CUST-003`).
- **Likely screens:** Customer 360 (support-scoped view), order
  detail, cancellation/return/refund action screens.
- **Likely permissions:** Read customer PII within a scoped/minimized
  view (see `CUSTOMER_360.md` §2 data-minimization note); initiate
  (not necessarily unilaterally approve) cancellations/returns/refunds.
- **High-risk actions:** Issuing a manual refund or goodwill credit
  outside standard policy.
- **Approval requirements:** Out-of-policy actions (e.g., a refund
  outside the standard window) require escalation; the exact threshold
  is a configurable business parameter (engineering default, non-
  blocking), consistent with `REF-003`'s partial-refund handling.

## Marketing

- **Responsibilities:** Campaign creation (`24-marketing.md`),
  segmentation, promotion creation (`23-promotions.md`).
- **Likely screens:** Marketing and promotions admin screens.
- **Likely permissions:** Read customer segmentation data
  (aggregated/pseudonymized where possible); create/schedule
  campaigns and promotions.
- **High-risk actions:** Launching a promotion with significant margin
  impact; sending a campaign to the full customer base.
- **Approval requirements:** Large-scale campaigns/promotions require
  Business Admin sign-off above a configurable reach/spend threshold
  (engineering default, non-blocking).

## Finance

- **Responsibilities:** Refund reconciliation (`REF-003`), COD
  reconciliation (`IND-001`), invoicing/credit-note oversight
  (`TAX-004`, `TAX-005`), PO approval at value thresholds (`PO-001`).
- **Likely screens:** Payment/refund reconciliation dashboards,
  invoicing screens.
- **Likely permissions:** Read across payment/order/refund data;
  approve POs and refunds above defined thresholds.
- **High-risk actions:** Approving large refunds; PO approval.
- **Approval requirements:** This role often *is* the approver for
  other roles' high-risk actions.

## Analyst

- **Responsibilities:** Reporting and analytics consumption
  (`27-analytics-reporting.md`).
- **Likely screens:** Dashboards, reports.
- **Likely permissions:** Read-only across aggregated/reporting data;
  should not require direct access to raw customer PII if the
  reporting layer is properly aggregated — a data-minimization
  consideration worth confirming when `ANL-001` is decided.
- **High-risk actions:** None inherently.
- **Approval requirements:** N/A.

---

## RBAC decisions — resolved 2026-09-22

1. **`ADM-001`** — **DECIDED.** All eleven roles listed above are
   adopted; Merchandising and Catalog are kept distinct (not merged).
   Full permission matrix lives in `specs/28-admin.md`.
2. **`AUTH-002`** — **DECIDED.** MFA is mandatory for every role with
   elevated/approval authority (Super Admin, Business Admin, Finance,
   and any role granted approval permissions); available but optional
   for execution-only roles (e.g., Warehouse Operator).
3. **`ADM-003`** — **DECIDED.** Manual inventory adjustments require
   Warehouse Manager (or above) role, a mandatory justification field,
   and Finance co-approval above a configurable value threshold.
4. **Approval thresholds generally** — **DECIDED as a pattern**: every
   domain-specific "above a threshold" reference above (PO value,
   refund value, promotion scale, bulk price changes, campaign
   reach/spend) is implemented as a **configurable business
   parameter**, not hard-coded per domain. The Product Owner sets the
   actual threshold values operationally; the engineering pattern
   (configurable, Finance/Business-Admin-gated above the threshold) is
   consistent across all of them, per this recommendation.

No RBAC decision required for this document remains open. See
`blueprint/DECISION_REGISTER.md` `ADM-001`–`003`, `AUTH-002` for full
resolution text.
