# PII Data Inventory (M31 Security Hardening, 5F)

**Status:** ENGINEERING REFERENCE — technical inventory only. This
document identifies WHERE personal data lives and how it is technically
protected; it does NOT decide retention periods, lawful-basis, or
regulatory classification. Those remain `CUST-001`/`AUD-002`
(`blueprint/DECISION_REGISTER.md`), explicitly `UNDER_REVIEW` pending
qualified legal input — nothing here should be read as resolving them.

Grounded directly against `packages/db/prisma/schema.prisma` as of this
pass (2026-09-29) — every table named below was verified to exist with
the fields listed, not inferred from memory.

## How to read this table

`Purpose` is the specific product feature the data serves. `Access
roles` is the RBAC permission(s)/route(s) that can read the raw field —
see `specs/01-auth-rbac.md` for the full permission matrix. `At-rest
protection` states plainly whether the field is stored in cleartext,
hashed (one-way, cannot be recovered), or encrypted (reversible, key-
protected) — an honest statement of the CURRENT implementation, not an
aspiration.

## Customer identity & contact

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Mobile number | `Customer.mobile` | Primary login identity (OTP), order contact | Self (own record only), staff with `customer_service:manage`/order-fulfilment roles reading order contact | Cleartext (required — used for lookup/matching, delivery, SMS OTP dispatch) |
| Email | `Customer.email` | Optional contact, gift-card purchase receipt | Same as mobile | Cleartext |
| Full name | `Customer.fullName` | Display, invoicing | Same as mobile | Cleartext |
| OTP code | `OtpCode.codeHash` | Login credential (one-time) | Nobody — never read back, only compared | SHA-256 hash, never the plaintext code |
| Refresh token | `CustomerRefreshToken.tokenHash` | Session renewal credential | Nobody — never read back, only compared | SHA-256 hash |

## Address book

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Recipient name/mobile, line1/2, landmark, city, state, pincode | `CustomerAddress.*` | Delivery | Self only (M22 IDOR-tested); staff order-fulfilment roles read the address SNAPSHOT copied onto the order, not this table directly | Cleartext (required for courier handoff/printed labels) |

## Staff credentials

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Password | `StaffUser.passwordHash` | Staff login | Nobody — never read back, only compared | bcrypt |
| MFA (TOTP) secret | `StaffUser.mfaSecret` | Second factor for `MFA_REQUIRED_ROLES` | Nobody — decrypted transiently in-process for a single verify call, never returned in any API response | **AES-256-GCM encrypted** (M31 finding + fix — see `blueprint/DECISION_REGISTER.md`'s M31 entry; the column previously carried a comment claiming encryption that was never actually implemented) |
| Staff session token | Redis (`StaffSessionStore`), not Postgres | Active session | Nobody — opaque bearer token, resolved server-side only | Session lookup key is itself the credential; Redis is not internet-reachable (internal network only in any real deployment — see `security/DEPLOYMENT_READINESS.md`) |

## Payment

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Razorpay order/payment reference ids | `Payment.providerReferenceId`, `GiftCardPurchase.providerReferenceId` | Reconciliation with the payment provider | Staff `refund:manage`/`payment`-adjacent permissions | Cleartext — these are Razorpay's own opaque reference ids, never a card/UPI number. **No raw card, UPI VPA, or bank account number is ever stored anywhere in this codebase** — Razorpay's hosted Checkout.js flow means this application never receives raw payment-instrument data at all (see `security/PAYMENT_SECURITY_REVIEW.md`). |
| Full inbound webhook payload | `PaymentEvent.payload` (Json) | Audit trail / replay-safe idempotency record (PAY-003) | Staff `refund:manage`-adjacent | Cleartext Json. Razorpay's own webhook payloads carry masked card data only (e.g. `last4`), consistent with the "no raw card data" constraint above — but this table is currently **retained indefinitely with no pruning**, the same open retention question as everything else gated on `CUST-001`/`AUD-002`. |

## Gift cards (M30)

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Redemption code | `GiftCard.codeHash` | The actual spendable secret | Nobody — never read back, only compared; the plaintext is returned to the issuing caller exactly once at creation and never persisted | SHA-256 hash (see `GC-001` in `blueprint/DECISION_REGISTER.md`) |
| Last 4 digits | `GiftCard.codeLast4` | Staff-facing card identification without exposing the full secret | Staff `giftcard:read` | Cleartext (by design — low-entropy display fragment, same convention as a masked card number) |
| Purchase recipient email | `GiftCardPurchase.recipientEmail`, `GiftCard.recipientEmail` | Delivery of a purchased gift card | Staff `giftcard:read` | Cleartext |

## Audit trail

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Actor, action, entity, old/new value snapshots | `AuditLog.*` | Full auditability requirement (`specs/30-audit-compliance.md`) | Super Admin, Business Admin, Finance | Cleartext. **`oldValue`/`newValue` are deliberately scrubbed of raw PII** at the call site for every M22+ customer-mutation audit event (profile/address/size/comm-pref changes record only change METADATA — field names, flags, category/size ids — never the actual old/new PII value) — a genuine finding from the M22 independent-review repair, verified still true by this pass's own grep sweep (`grep -rn "oldValue:\|newValue:" src/modules/customer-profile/service.ts` shows no raw address/email/name value ever passed). Earlier-milestone audit events (inventory, pricing, orders) were never PII-bearing in the first place — their old/new values are quantities, prices, and status enums. |

## Return evidence (photos)

| Data item | Table.column | Purpose | Access roles | At-rest protection |
|---|---|---|---|---|
| Uploaded condition photo | `ReturnEvidence.objectKey` (file on local-disk provider, see `RETURN_EVIDENCE_STORAGE_DIR`) | Return QC evidence | Customer (own return only, IDOR-tested), staff QC roles | File stored outside any statically-served directory; MIME-sniffed at upload (magic bytes, never the client-declared Content-Type) — see the M19 independent-review repair narrative in `CLAUDE.md`. May incidentally contain identifying imagery (a person's home, packaging with an address label) — not specifically redacted, an accepted product-shape risk, not a code defect. |

## Logs

`packages/shared/src/logger.ts` (pino) logs request metadata (method,
path, status, duration) at the Fastify framework level by default —
**never request/response bodies**, so OTP codes, passwords, MFA secrets,
gift-card codes, and refresh tokens are never captured by the access
log merely by virtue of a request happening. Application-level `log.*`
calls across every module were grep-swept for this pass
(`grep -rn "log\.\(info\|warn\|error\|debug\)" src | grep -iE "password|otp|mfa|token|secret|giftcard.*code"`)
— the only matches are error-context logs that pass an already-caught
`Error` object or a non-secret identifier (order id, sku id), never a
raw credential value.

## Summary of this pass's own findings

1. **Genuine gap found and fixed:** `StaffUser.mfaSecret` was plaintext
   despite a comment claiming otherwise — now AES-256-GCM encrypted (see
   `mfa-secret-crypto.ts`).
2. **No raw payment-instrument data anywhere** — confirmed by code
   inspection (Razorpay hosted Checkout.js, `Payment`/`PaymentEvent`
   schemas carry only provider reference ids and masked webhook fields).
3. **Audit-log PII scrubbing already correct** (M22 repair), reverified
   here.
4. **`PaymentEvent.payload` and `AuditLog` rows retained indefinitely** —
   an accepted, explicitly open item tied to `CUST-001`/`AUD-002`, not a
   new finding invented here; this pass does not set a retention
   duration, per the task's own explicit prohibition on inventing one.
