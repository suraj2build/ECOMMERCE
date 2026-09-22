# M22 — Customer 360 Acceptance Criteria

**Spec(s):** `specs/21-customer-profile.md`
**Status:** READY_FOR_IMPLEMENTATION for the features below;
data-retention *policy* specifics remain `UNDER_REVIEW`
(`CUST-001`) and are out of this milestone's testable scope.

## Business acceptance

- [ ] Customer profile, address book, order history, shipment
      tracking, wishlist, recently viewed, saved sizes ("My Sizes"),
      ratings/reviews access, loyalty balance/history, store-credit
      balance/history, coupons, and communication preferences are all
      present and functional in the customer's account.
- [ ] Communication preferences are settable per channel (SMS/
      WhatsApp/Email/Push) and per message type — not one global
      toggle.

## Functional acceptance

- [ ] Address book supports the Indian address structure with multiple
      saved addresses and a default selection.
- [ ] Order history correctly reflects live order/shipment status
      (reads from `acceptance/m15-order-management.md` and
      `acceptance/m17-shipping-tracking.md`).

## Authorization

- [ ] A customer can access **only their own** profile/orders/data —
      verified by attempting to access another customer's order via
      direct ID manipulation and confirming it is rejected
      server-side.
- [ ] The internal CS-facing Customer 360 admin view is a distinct,
      separately-authorized screen (`acceptance/m29-admin-cms.md`), not
      the same endpoint as the customer's own profile API.

## Negative scenarios / edge cases

1. Customer attempts to view another customer's order by guessing/
   incrementing an order ID → 403/404, not the other customer's data.
2. Recently-viewed list correctly excludes items after a reasonable
   retention window (implementation-defined, but must not grow
   unbounded).

## Mobile / Desktop behavior

- [ ] Account/profile screens are fully usable on both viewports.

## Test requirements

- [ ] Authorization test: cross-customer data access is blocked
      (`acceptance/e2e-commerce-flows.md` FLOW 19 pattern applied to
      customer-to-customer, not just role-to-role).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. Data-retention-
policy-specific criteria are deferred pending `CUST-001` resolution and
do not block this milestone's completion for the features above.
