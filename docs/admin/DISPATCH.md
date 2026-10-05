# Dispatch: scanning, parcel measurements, documents and handover

Status: IMPLEMENTED on `claude/admin-ops-phase1`, awaiting implementation
review. This follows the Product Owner's review of 2026-10-05: "build
barcode verification, parcel weight/dimensions and dispatch documents",
plus decision AO-D5 ("separate booking from actual handover; review stock
and accounting consequences before moving sale posting").

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
4. Confirm.

A carrier's first in-transit tracking event also records the handover
automatically, if it arrives first. Recording a handover twice is
harmless: the parcels are locked in a fixed order first, so two people
confirming the same parcel at once record it (and audit it) once.

The page shows up to 500 waiting parcels. When there are more, it says
how many there are in total and that only the oldest 500 are listed.

## Dispatch stage in the admin

The admin distinguishes the two states a booked package can be in. Both
are `SHIPPED` underneath, so this is a label, not a new status:

| Stage | Shown as | Meaning |
|---|---|---|
| `BOOKED_AWAITING_COLLECTION` | **Booked — awaiting collection** | booked with a courier, not yet handed over |
| `HANDED_OVER` | **Handed over** | the courier took it (staff handover or carrier event) |

The stage shows on the Pack & ship list and on the order page. The Pack & ship list can be filtered by either stage. A booked
package also says "Stock already deducted at booking", because that is
still true (see below).

## Settings (Business & warehouse → Dispatch checks)

Whether scanning is required at pick, at pack, or both (B-2), and whether
parcel weight and dimensions are required at pack (B-3), are **the
owner's choices**. They are stored as admin settings, **all off by
default**, and changing them needs `org:manage`.

When a check is off, a scan or measurement that **is** entered is still
checked. When a check is on, packing or picking without it is refused.

## AO-D5: booking vs handover (what changed and what did not)

- **Changed:** handover is a separate, recorded event on the shipment:
  - `handedOverAt`;
  - who handed it over, or "carrier event";
  - the courier's reference.

  Booked-but-not-collected parcels are visible on the handover page and
  can be counted.
- **Not changed:** the inventory sale (`SALE`, or `EXCHANGE_DISPATCH` for
  an exchange replacement) is still posted when the shipment is booked.
  The fulfilment still becomes `SHIPPED` at booking. Moving the sale to
  handover affects:
  - cancellation of booked parcels;
  - order status;
  - analytics ship dates;
  - exchange dispatch;
  - concurrency between webhook, staff and cancellation.

  These are listed in `NEXT_PHASES_RESEARCH.md` ("Proposal: move shipped
  from carrier booking to handover"). The Product Owner asked for that
  review **before** the posting point moves, so it has not moved.
- **What this means today:** a parcel that is booked but never collected
  has already left stock in the ledger. The handover page and the
  "Booked — awaiting collection" filter are where to see such parcels.
- **AO-D5 is therefore partly implemented.** The review of what moving the
  sale would change is `BOOKING_TO_HANDOVER_REVIEW.md`. It recommends
  option B: the sale, the shipped status and the customer's shipped
  message all move to handover, with a rule for cancelling a booked
  parcel. It needs the Product Owner's decision before anything moves.
- **Fixed while reviewing:** the "shipped" message to the customer (and
  the "delivered" one) was sent from inside the booking transaction, so a
  booking that then failed could still have told the customer it had
  shipped. Both are now sent only after the change is committed.

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
  by staff and by carrier event; repeat handover; SALE still posted at
  booking; permissions; the dispatch stage and its filters; two
  simultaneous handovers of one parcel; the list total beyond its limit;
  the shipped message sent only after the booking commits.
- Browser flow AO-10 in `test/e2e-admin/p1-console.spec.ts` (it reuses that
  file's order and pick fixtures).
