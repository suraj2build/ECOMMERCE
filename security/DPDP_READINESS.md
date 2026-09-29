# DPDP Readiness — Engineering Capability Only (M31 Security Hardening, 5G)

**Status:** ENGINEERING READINESS ONLY. This document does **not** claim
`DPDP_COMPLIANT`. India's Digital Personal Data Protection Act, 2023
imposes specific legal obligations (notice content, consent-manager
registration, breach-notification timelines, data-fiduciary/processor
classification, cross-border transfer rules) that require qualified
legal review — explicitly out of scope for an engineering pass per
`CLAUDE.md`'s global safety rule against inventing "DPDP legal
interpretations, retention periods, consent requirements." What follows
is a plain statement of which technical CAPABILITIES already exist,
which are net-new from this pass, and which remain unbuilt — not a
compliance determination.

## Capability inventory

| DPDP-relevant capability | Status | Where |
|---|---|---|
| Privacy notice display | **Not built.** No storefront page presents a privacy notice or records which version a customer saw. | — |
| Consent record (per data use) | **Partially present.** `CommunicationPreference` (M22) records per-channel × per-message-type opt-in/opt-out, but this is a marketing-communication preference, not a general-purpose "consent to processing" record with a versioned notice reference. | `CommunicationPreference` model |
| Consent withdrawal | **Present, for the one consent type that exists.** `PUT /storefront/account/communication-preferences` lets a customer flip any preference at any time, immediately effective (M22 repair, finding 3 — removed an invented non-opt-outable rule). | `customer-profile/routes.ts` |
| Right to access (data export) | **Not built.** No "download my data" endpoint exists. | — |
| Right to correction | **Present, for account fields.** Profile (`PATCH /storefront/account/profile`), addresses (full CRUD), sizes, and communication preferences are all self-service editable. Order/payment/audit history is correctly NOT editable (financial-integrity requirement, not a gap). | `customer-profile/routes.ts` |
| Right to erasure/deletion | **Not built.** No account-deletion or anonymization workflow exists. Note: any future implementation must reconcile against this codebase's OWN certified financial-integrity/audit-retention requirements (`specs/30-audit-compliance.md` — full auditability of orders/refunds/loyalty/store-credit is a DECIDED requirement) — a naive hard-delete would conflict with that decided requirement, which is exactly why this is a genuine open design question, not a simple CRUD gap. |
| Grievance/contact channel | **Not built** as a dedicated DPDP grievance-officer workflow. `SupportService` (M29) exists for staff-side customer-service lookups, not a customer-initiated complaint intake. |
| Processor/vendor inventory | **Informal only.** Razorpay (payments), the configured shipping carrier (`SHIPPING_PROVIDER`), Meilisearch (self-hosted, not a third-party processor), and the marketing provider (`MARKETING_PROVIDER`, currently MOCK only, MKT-001 — no real vendor selected) are the only external data recipients that exist today, all already behind their own provider-abstraction interfaces. No formal register/DPA tracking exists. |
| Breach/incident operational readiness | **Documentation only** — see `security/RUNBOOKS.md`'s incident-response section. A runbook is not itself proof of operational readiness (this document says so explicitly, per this pass's own instruction not to overclaim). |

## What this pass did NOT do, and why

- **Did not build a consent-manager integration.** DPDP's Consent
  Manager framework is a registered-third-party mechanism with its own
  regulatory approval process — not something an engineering pass can
  stand up unilaterally, and doing so without legal sign-off on scope
  would be exactly the kind of invented compliance claim `CLAUDE.md`
  prohibits.
- **Did not invent a retention period** for erasure/anonymization —
  `CUST-001`/`AUD-002` remain the authoritative, still-open decisions
  gating this.
- **Did not build data-export/erasure endpoints** in this pass. Building
  them without first resolving the audit-retention conflict noted above
  would risk shipping a capability that either violates the DECIDED
  audit-completeness requirement (if erasure is naive) or silently does
  nothing useful (if erasure is scoped so narrowly it excludes
  everything DPDP actually cares about) — a genuine architectural
  question for a future, explicitly-scoped pass with both legal and
  product input, not a mechanical CRUD addition.

## Recommended next steps (not authorized to build here)

1. Legal review to classify this platform's actual data-fiduciary
   status and confirm which DPDP obligations apply to the specific data
   categories in `security/PII_DATA_INVENTORY.md`.
2. A resolved `CUST-001`/`AUD-002` retention policy, which erasure/
   export design must be built against.
3. A dedicated, explicitly-authorized milestone for consent-record
   versioning, data export, and erasure/anonymization — informed by (1)
   and (2), not preceding them.
