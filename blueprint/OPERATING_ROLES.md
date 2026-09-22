# Operating Roles (Admin / Operations Personas)

**Status:** These are **candidate** roles surfaced by analyzing the
full domain list in `PRODUCT.md` and `/specs` — **none are approved**.
`ADM-001` in `DECISION_REGISTER.md` is the decision that finalizes the
actual role list and permission matrix; this document exists to give
that decision concrete starting material.

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
  edit core product-master attributes (that's Catalog Manager, below)
  unless the two roles are merged — open question for the Product
  Owner.
- **High-risk actions:** Price changes at scale (`PROD-006` bulk
  operations); publishing a product before enrichment is complete
  (`PROD-003`).
- **Approval requirements:** Bulk price changes may warrant a
  Business Admin approval step — not yet decided.

## Catalog Manager

- **Responsibilities:** Product master data quality, attribute
  taxonomy stewardship (`PROD-001`), enrichment workflow ownership.
- **Likely screens:** `specs/02-product-master.md` screens.
- **Likely permissions:** Full read/write on product master; may
  overlap significantly with Merchandiser — **the Product Owner should
  confirm whether Merchandiser and Catalog Manager are one role or two**
  distinct ones, since the domains (`02` vs. `07`) are closely coupled.
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
- **Approval requirements:** Manual adjustments above a threshold
  should likely require a second approval or a mandatory justification
  field — exact rule is part of `ADM-003`.

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
  outside the standard window) should likely require escalation —
  exact threshold not yet decided.

## Marketing

- **Responsibilities:** Campaign creation (`24-marketing.md`),
  segmentation, promotion creation (`23-promotions.md`).
- **Likely screens:** Marketing and promotions admin screens.
- **Likely permissions:** Read customer segmentation data
  (aggregated/pseudonymized where possible); create/schedule
  campaigns and promotions.
- **High-risk actions:** Launching a promotion with significant margin
  impact; sending a campaign to the full customer base.
- **Approval requirements:** Large-scale campaigns/promotions likely
  warrant Business Admin sign-off — not yet decided.

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

## Decisions needed to finalize RBAC

1. **`ADM-001`** — Confirm which of the above roles actually exist in
   the organization (some may be merged, e.g., Merchandiser + Catalog
   Manager), and define the exact permission matrix per role.
2. **`AUTH-002`** — Which roles require mandatory MFA.
3. **`ADM-003`** — The specific approval workflow for manual inventory
   adjustments (Warehouse Manager's highest-risk action).
4. A decision on **approval thresholds generally** — several roles
   above reference "above a threshold" without that threshold being
   defined anywhere (PO value, refund value, promotion scale). This
   cuts across `PO-001`, `ADM-003`, and Finance's refund-approval
   scope — recommend the Product Owner set these as a single
   consistent policy rather than domain-by-domain.
