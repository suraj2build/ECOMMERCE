# Dispatch: scanning, parcel measurements, documents and handover

Status: IMPLEMENTED on `claude/admin-ops-phase1`, awaiting implementation
review. This follows the Product Owner's review of 2026-10-05: "build
barcode verification, parcel weight/dimensions and dispatch documents",
plus decision AO-D5 ("separate booking from actual handover; review stock
and accounting consequences before moving sale posting"), decided as
option B on 2026-10-06: the handover, not the booking, posts the sale.

## What the owner does

**Pick (Warehouse → Picks).** Open a task and scan the item's barcode.
The scan must match the size's barcode. Scanning a different item is
refused, and so is scanning an item with no barcode set up. Then enter
the quantity as before.

**Pack (Orders → Pack & ship → package → Mark packed).** Scan every unit
as it goes into the parcel. The server compares the scans with the
package's order lines, unit by unit. It refuses with a plain explanation
when:
- an item is missing;
- an item is extra;
- an item belongs to another order;
- a scanned code is unknown.

Then enter the parcel's gross weight (g) and its length, width and height
(cm). These are stored with the package and sent to the courier when the
shipment is booked.

**Documents (package → Packing slip / Address label).**
- **Packing slip:** the order reference, ship-to and ship-from addresses,
  and every item with SKU, barcode, quantity and a tick box. It also shows
  the unit count and the parcel measurements.
- **Address label:** the delivery address and phone, the order reference,
  and the courier and tracking reference once booked. It shows "cash on
  delivery, collect ₹X" (the COD payment amount recorded at checkout) or
  "prepaid", and the return address.
- Both print from the browser; the admin menus are hidden in print. **The
  address label is not a courier's shipping label.** Each courier has its
  own label format and barcode, and these come from the courier's system
  once one is chosen (LR-008). No courier format was invented.

**Booking needs the sender address.** A package can be booked with a
courier only when its warehouse (the location it is dispatched from) has
a full address: address line, city, state and PIN code. That address is
the sender and return address on the label. Without it, the booking is
refused, nothing is sent to the courier, and the refusal names what is
missing and where to add it (Business & warehouse). Setup & health shows
the same gap. A retry of a booking that was already made still returns
it. Marking a package shipped manually (outside the courier integration)
is not affected. *(Product Owner review after `6217031`.)*

**Courier handover (Orders → Courier handover).** This lists parcels
booked with a courier but not yet collected, grouped by courier.
1. Print the manifest. It has a signature line for "handed over by" and
   "received by".
2. Tick the parcels the courier actually took.
3. Optionally enter the courier's pickup or manifest reference.
4. Confirm. This posts the stock sale, marks the packages shipped and
   sends account holders their "shipped" message (AO-D5 option B).

A carrier's first in-transit tracking event also records the handover
automatically, if it arrives first. Recording a handover twice is
harmless: the parcels are locked in a fixed order first, so two people
confirming the same parcel at once record it (and audit it) once.

The page shows up to 500 waiting parcels. When there are more, it says
how many there are in total and that only the oldest 500 are listed.

## Dispatch stage in the admin

| Stage | Shown as | Meaning |
|---|---|---|
| `BOOKED_AWAITING_COLLECTION` | **Booked — awaiting collection** | booked with a courier, not yet handed over (package status `BOOKED`) |
| `HANDED_OVER` | **Handed over** | the courier took it; the package is `SHIPPED` |
| `CANCELLED` | **Cancelled** | the booking was cancelled before collection |

A package booked before option B was built is `SHIPPED` but shows as
"Booked — awaiting collection" until its handover is recorded, with the
note that its stock was already deducted at booking. The Pack & ship list
can be filtered by each stage.

## Settings (Business & warehouse → Dispatch checks)

Whether scanning is required at pick, at pack, or both (B-2), and whether
parcel weight and dimensions are required at pack (B-3), are **the
owner's choices**. They are stored as admin settings, **all off by
default**, and changing them needs `org:manage`.

When a check is off, a scan or measurement that **is** entered is still
checked. When a check is on, packing or picking without it is refused.

## AO-D5 option B: the handover posts the sale

Decided by the Product Owner on 2026-10-06 (`blueprint/DECISION_REGISTER.md`
→ AO-D5).

- **Booking** (`ShippingService.createShipment`) books the parcel and moves
  the package `READY_TO_SHIP -> BOOKED`. No stock moves, the lines stay
  packed, and the customer gets no message. A failed booking leaves the
  package ready to ship; its retry is idempotent as before.
- **Handover** is whichever comes first:
  - staff confirm it on the Courier handover page
    (`DispatchService.recordHandover`), or
  - the carrier reports the parcel moving (in transit, out for delivery,
    delivered or a failed attempt).

  In one transaction it posts one `SALE` per order line (or one
  `EXCHANGE_DISPATCH` for an exchange replacement), marks the package and
  its lines `SHIPPED`, and records the handover. The `ORDER_SHIPPED`
  message is sent after that commits.
- **Exactly once.** The shipment row is locked first, then the package row
  (the same order in booking, handover, carrier events and cancellation).
  Only a `BOOKED` package can move to `SHIPPED`, and the ledger allows one
  `SALE` per order line. A staff confirmation and a carrier event arriving
  together post one sale; a repeated event or confirmation changes nothing.
- **Split shipments.** Each package is handed over, and sold, on its own.
- **Packages booked before option B** are already `SHIPPED` with their
  sale posted. Their handover is recorded and nothing is posted again.
- **A manual "Mark shipped"** (a parcel sent outside the courier
  integration) still goes `READY_TO_SHIP -> SHIPPED` and posts the sale at
  once. It is refused for a booked package, which waits for its handover.

### Cancelling a booked package

Before the courier collects it, staff with `order:cancel` can cancel the
whole package from the order page (**Cancel booking**). They must first
cancel the booking with the courier themselves (there is no courier
adapter yet, LR-008), tick that they did, and give a reason. In one
transaction:

- the shipment becomes `CANCELLED` (who, when and the courier's reference
  are kept), and later carrier events for it are refused;
- every line in the package is cancelled through the normal cancellation
  path: stock released, a prepaid order flagged for refund with a credit
  note, loyalty reversed;
- the package becomes `CANCELLED`.

A retry returns the cancelled package. While a package is booked, its
lines cannot be cancelled one by one (by staff or by the shopper) and
cannot be flagged as exceptions. A handover and a cancellation racing
each other are serialised by the shipment lock: one wins, the other is
refused. An exchange replacement package is not cancelled this way (see
below). Once handed over, it is a return, not a cancellation.

### A replacement booked by mistake (exchange)

An exchange replacement package has no order lines to cancel, and the
exchange itself should go on. Before the courier collects it, staff with
`exchange:fulfil` cancel its booking from the exchange page (**Cancel
booking**; `POST /exchanges/:id/fulfilment/cancel-booking`), after
cancelling it with the courier, ticking that they did and giving a
reason. In one transaction (shipment, then package, then exchange locked
in that order):

- the shipment becomes `CANCELLED` (who, when and the courier's reference
  are kept), and later carrier events and handovers for it are refused;
- the package becomes `CANCELLED` and is detached from the exchange (it
  keeps a link to it, `cancelledExchangeId`, so Pack & ship and the
  exchange page still show it);
- nothing else changes: no stock moves (the replacement left nothing at
  booking), the exchange stays `REPLACEMENT_ALLOCATED`, its pick task
  stays picked and its reservation stays in place, and nothing is
  refunded or cancelled.

Staff then **Create replacement package** again on the exchange, pack it,
mark it ready and book it; its handover posts the `EXCHANGE_DISPATCH`
once, and delivery completes the exchange as usual. A retry with the same
request key returns the same cancelled package; the same key used for a
different exchange is refused. After the courier has collected the
parcel, cancelling is refused. A handover racing the cancellation is
serialised by the shipment lock: one wins, the other is refused.

This recovers a wrong *booking* (wrong parcel size, wrong courier
details, booked too early). It does not change the replacement *item*:
that is fixed when the exchange is requested, and an exchange can only be
cancelled before its original item is received. Changing the replacement
item after allocation has no path today; it is reported, not built.

### Customer view

The order page shows a booked package as "Packed, waiting for the courier
to collect it" (not shipped) and hides its Cancel buttons.

- **Fixed earlier:** the "shipped" and "delivered" messages are sent only
  after the change is committed.

## Not included (needs a courier or a decision)

- A courier's own labels, manifests, pickup booking and cancellation all
  need a real courier adapter (LR-008).
- Product weights on SKUs (for estimating parcel weight without a scale),
  pending B-3.
- Scanner and scale hardware were not tested here. Keyboard-wedge USB
  scanners type the code and press Enter, which is what the scan fields
  expect.

## Tests

- `services/commerce-api/test/integration/dispatch.test.ts`: pick-scan
  match and mismatch; pack scans (exact, missing, extra, foreign,
  unknown); parcel measurements stored and sent with the booking;
  settings requiring scans and measurements; documents content; handover
  by staff and by carrier event; repeat handover; permissions; the
  dispatch stage and its filters; two simultaneous handovers of one
  parcel; the list total beyond its limit. AO-D5 option B: no sale or
  stock change at booking; the sale posted once at handover; a staff
  handover racing the carrier's event; split shipments; a failed booking;
  a package shipped before option B; cancelling a booked package (line
  cancels and exceptions refused, stock released, later carrier events
  refused); a handover racing a cancellation; the shipped message sent
  only after the handover commits.
- `shipping.test.ts` and `exchange-fulfilment.test.ts`: booking retries
  and races post no sale, the handover posts one; an exchange replacement
  posts its dispatch at handover and cannot be cancelled as an order
  booking; a mistaken replacement booking is cancelled from the exchange
  (confirmation, reason and permission required; no stock moves; the
  exchange stays allocated; idempotent retry; key reuse refused; refused
  before booking and after collection; carrier events and handover for
  the cancelled parcel refused), then a new package is booked, handed
  over (one dispatch) and delivered (exchange completed); a handover
  racing that cancellation.
- Browser flows AO-10 (dispatch and handover), AO-11 (cancelling a
  booked package) and P1-08 (an exchange replacement booked, its booking
  cancelled, rebooked, handed over and delivered) in `test/e2e-admin/p1-console.spec.ts` (they reuse that
  file's order and pick fixtures).
