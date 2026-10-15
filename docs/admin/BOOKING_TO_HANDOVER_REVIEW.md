# Booking vs handover: stock and accounting review (AO-D5)

Status: DECIDED — option B (Product Owner, 2026-10-06) and IMPLEMENTED on
`claude/admin-ops-phase1`; see `DISPATCH.md` ("AO-D5 option B"). Sections
1-4 below describe the behaviour before option B and are kept as the
review that informed the decision.

The Product Owner's decision AO-D5 (2026-10-05) was: "Separate booking from
actual handover. Review stock and accounting consequences before moving
sale posting." Handover is now recorded separately
(`docs/admin/DISPATCH.md`). This document is the review asked for before
the sale posting moves. Every statement below was checked against the code
on `claude/admin-ops-phase1`.

## 1. What happens at booking today

`ShippingService.createShipment` (`services/commerce-api/src/modules/shipping/service.ts`)
books the parcel with the courier, then, in one database transaction:

1. sets the shipment to `BOOKED` with the courier's references;
2. calls `OrderService.markFulfilmentShipped`, which:
   - posts one `SALE` stock movement per order line
     (`InventoryService.recordSale`), or one `EXCHANGE_DISPATCH` for an
     exchange replacement. Each reduces both on-hand and reserved by the
     quantity, and a database index allows at most one per order line;
   - sets the package (`OrderFulfilment`) and its lines to `SHIPPED` and
     stamps `shippedAt`;
   - recomputes the order status (it becomes `SHIPPED` when every active
     line has shipped).

After that transaction, the customer is sent the `ORDER_SHIPPED` message
("Your order … has shipped").

Handover is recorded later and separately: by staff on the Courier
handover page, or by the carrier's first movement event. It changes no
stock and no status.

## 2. What a booked but uncollected parcel looks like today

| Where | What it shows | Is that true? |
|---|---|---|
| Stock ledger | Units gone (SALE posted) | No. The parcel is still on the shelf |
| Stock customers can buy | Unchanged | Yes (see §3.1) |
| Package and order status | Shipped | No. It is only booked |
| Customer message | "has shipped" | No |
| Cancel the line | Refused ("use a return instead") | Not physically necessary: the parcel could be unpacked |
| Admin handover page | Listed as awaiting collection | Yes |

## 3. Consequences of moving the sale to handover, area by area

### 3.1 Stock customers can buy: no change

Available-to-sell is on-hand minus reserved. The units are reserved for
the order from allocation until the sale. The sale takes the same quantity
off both, so availability is identical whether the sale is posted at
booking or at handover. Channel feeds (Google Merchant, Meta catalogue) and
the storefront use the same figure, so they are unaffected.

### 3.2 Physical stock counts: improves

Today a stock count taken while parcels wait for the courier finds more
units on the shelf (inside parcels) than the ledger's on-hand. Posting the
sale at handover makes the ledger match the shelf until the courier
actually takes the parcel.

### 3.3 Accounting: no entries move

This platform has no general ledger or cost-of-goods postings. Margin
reports (`AnalyticsService`) are computed from purchase-order cost and
order-line values, not from stock movements, and nothing in analytics
reads `shippedAt` or the shipped status. Moving the sale changes the stock
ledger's timing only.

Tax invoices are issued when the order is confirmed (M15), well before
booking, and that would not change. Whether the invoice or e-way bill must
reflect the actual removal of goods is a tax question: **TAX/COMPLIANCE
REVIEW REQUIRED** (with `TAX-001`–`005`). This review does not answer it.

### 3.4 Order status and customer messages: changes

The package and order would stay at a new "booked, awaiting collection"
state until handover, and the `ORDER_SHIPPED` message would be sent at
handover instead of at booking.

A defect found during this review applies today: when booking goes through
`createShipment`, the shipped message is sent from inside the booking's
database transaction, before it commits (`markFulfilmentShipped` sends it
after its own work but is given the caller's open transaction). If the
commit then failed, the customer would have been told the order shipped
when it had not. **Fixed now, independently of this decision:** the
shipped and delivered messages are sent only after the change commits
(`OrderService.notifyFulfilmentShipped` / `notifyFulfilmentDelivered`,
called by `ShippingService` after its transaction; covered by
`dispatch.test.ts`). If the message later moves to handover, it moves
with the same after-commit rule.

### 3.5 Cancellation: needs a rule

Today a line cannot be cancelled once its package is booked (it is
`SHIPPED`). If the sale moves to handover, a booked line is not yet
shipped, so the question is whether it may be cancelled before collection.
Physically yes, but the courier booking must also be cancelled, which
needs a courier adapter (LR-008) or a manual step at the courier's portal.

Proposed rule (needs approval): a booked package can be cancelled only by
staff, only before handover, and only after confirming the courier booking
was cancelled. The units then go back to the shelf (the reservation is
released exactly as cancellation does today). Customer self-service
cancellation stays limited to before booking.

### 3.6 Exchanges: same as orders

An exchange replacement posts `EXCHANGE_DISPATCH` instead of `SALE`, from
the same place. It moves the same way and has the same exactly-once index.

### 3.7 Returns, return windows, loyalty points, COD collection: no change

Return and exchange windows, loyalty vesting and COD collection all start
from delivery, not shipping. Returns-to-origin need every line shipped,
and a parcel cannot be returned by the courier before it was collected.

### 3.8 Concurrency: covered by existing guards

The sale would be posted by whichever comes first: staff confirming
handover, or the carrier's first movement event (a webhook or a poll). The
one-sale-per-line index and the package row lock already make a second
attempt a no-op, so the two paths cannot post twice. Cancellation would
take the same package row lock, so a cancellation and a handover cannot
both succeed. This needs new tests (listed in §5), not new locking.

### 3.9 Parcels never collected

Today they have already left the stock ledger; someone has to notice them
on the handover page and correct stock by hand. After the move they stay
on-hand and reserved until handover or cancellation, so nothing needs
correcting.

## 4. Options

| | A. Keep as today | B. Move sale and shipped status to handover (recommended) | C. Move the sale only |
|---|---|---|---|
| Ledger matches the shelf before collection | No | Yes | Yes |
| Order/customer see "shipped" only once collected | No | Yes | No |
| Booked package can be cancelled before collection | No | Yes, by staff with courier confirmation | Confusing: status says shipped |
| Work | Fix the early shipped message only | New package status, sale at handover, cancellation of a booked package, message timing, admin labels | Partial; leaves status and stock disagreeing |

## 5. Recommendation and what option B involves

Option B. Scope, for when it is approved:

- a package status between ready-to-ship and shipped ("Booked — awaiting
  collection"); booking sets it and records the courier references;
- the sale (or exchange dispatch), shipped status, `shippedAt` and the
  customer message move to handover: staff confirmation or the carrier's
  first movement event, whichever comes first, exactly once;
- staff cancellation of a booked package before handover, with a courier
  cancellation confirmation, releasing the reservation;
- packages already booked when the change is deployed keep their posted
  sale (no back-dated changes); only new bookings follow the new rule;
- tests: sale posted once under concurrent staff handover and carrier
  event; handover vs cancellation race; availability unchanged across
  booking and handover; stock count matches before collection; message
  sent once, after commit; exchanges; existing shipping, cancellation and
  exchange suites unchanged.

## DECISION_REQUIRED

Question: approve option B (sale, shipped status and customer message at
handover) and the cancellation rule in §3.5?
Why it matters: until then, a booked parcel leaves stock and reads as
shipped before the courier has it.
Options considered: A, B, C above.
Also needed separately: the tax review in §3.3, and a courier choice
(LR-008) for automatic booking cancellation.
