# Solo-owner desktop walkthrough (2026-10-05)

Asked for by the Product Owner after CI passed on `57f0f53`. The question
was whether the admin makes one person's working day easy, not whether
the tests pass. For each screen: is the next action obvious, is typed
work kept, and is a failure explained clearly?

## How it was run

- **Setup.** A browser (1440 × 900) drove the production build of the
  API, storefront and admin (`NODE_ENV=production`,
  `DEPLOYMENT_STAGE=preview`), working on their own fresh database. It
  did not touch the demo or the test databases.
- **Users.** The owner signed in as a super admin. A second person, a
  warehouse manager, had their own login so the independent-approval
  path could be checked.
- **Data.** Every step went through the screens, with no API shortcuts,
  except two:
  - creating the second staff member, which has no screen (W-23);
  - setting a shopper's address, which uses one of the five PIN codes the
    delivery area allows (W-11).
- **Record.** Each finding below was seen on screen and captured in a
  screenshot; the screenshots are kept outside the repository.

The five steps:

1. **Product.** Create a polo in four sizes and two colours. Fix
   readiness issues: a duplicate style code, a corrupt photo, a selling
   price above MRP and a missing all-colours price. Then publish.
2. **Stock.** Create a supplier and a purchase order (PO). Receive the
   stock, with the owner approving it.
3. **Order and packing.** A shopper places a cash-on-delivery order on
   the storefront. Pick it with a scan, then pack it with scans and
   parcel measurements, and print the packing slip and address label.
4. **Courier.** Book the parcel, confirm the handover on the handover
   manifest, and poll tracking.
5. **Failures.** Try a wrong scan at pick and at pack, an approval
   request that gets rejected, a cancellation after shipping (refused)
   and one before shipping (allowed).

## What already worked well

- **Typed work is kept after a refusal.** This held for:
  - the product basics form (it also offers to restore unsaved work
    after a closed tab);
  - receiving quantities;
  - the pick scan;
  - the reason given on a rejection.
- **These refusals were already clear:**
  - a duplicate barcode;
  - a corrupt photo;
  - selling above MRP (checked before you save);
  - the wrong item at pick;
  - a missing pack scan;
  - cancelling a line that has shipped ("use a return instead").
- **Approvals.** An approval request reached the owner. Rejecting it
  needs a note, and the person who asked sees the outcome and the note.
- **Cancellation.** Cancelling before shipping removed the pick task and
  released the stock.

## Findings and what was done

"Fixed" means the change is in this commit range and covered by the tests
listed under "Tests" below.

| # | Screen | Finding | Result |
|---|---|---|---|
| W-1 | Overview | All-zero counters with no "start here"; the roles line says `SUPER_ADMIN` | Open (minor) |
| W-2 | Product basics (and every long form) | A failed save showed its error at the top of the form, off-screen from the Save button, and named the internal field (`styleCode`) | **Fixed.** Errors scroll into view when shown. A duplicate value reads "Style with this style code already exists. Use a different style code." |
| W-4 | Pricing | The price history table was cut off in a half-width card ("Unt" for Until) | **Fixed.** Prices and the price form stack at full width |
| W-5 | Readiness | Published with 0 stock showed "Can be bought: Yes / On the storefront" while every size was sold out | **Fixed.** It now shows "Not yet — on the storefront, but every size shows as sold out until stock is received", plus a warning that links to receiving |
| W-6 | Purchase order (draft) | Submit, Approve, Reject and Cancel were all offered, and so was the receiving form; receiving a draft failed with "in status 'DRAFT'" | **Fixed.** Only the actions valid for the status are offered. The receiving form appears only once the PO is approved. A "Next step" line says what to do |
| W-6b | Suppliers | The Contact column shows "—" when only an email was entered | Open (minor) |
| W-7 | Purchase order | "Submit for approval: done." left every button in place | **Fixed.** Specific messages, e.g. "Submitted for approval. Once it is approved, receive the goods on this page." |
| W-8 | Approving your own PO (owner approval off) | Approve stayed enabled and failed with "Request validation failed" | **Fixed.** The dialog explains why and the confirm button is disabled |
| W-9 | Owner approval dialog | A refusal (short reason, wrong password) closed the dialog and lost what was typed | **Fixed.** The dialog stays open with the refusal shown inside it |
| W-10 | Receiving | "requires Warehouse Manager sign-off (managerSignoffStaffId)" | **Fixed.** It now explains in plain words who must sign off, and how |
| W-11 | Delivery area | Only five PIN codes are serviceable, and there is no screen to see or change them | **Report.** This normally comes from the courier (LR-008) |
| W-12 | Pick scan | Pressing Enter on a scan gave no feedback | **Fixed.** "Right item: …" or "Wrong item: … Put it back and scan the right one." |
| W-13 | Pick queue | No confirmation of the pick, and the empty queue gave no pointer to the next step | **Fixed.** A confirmation with a link to Pack & ship, and an empty state that says where picked orders go |
| W-14 | Picked → packed | **Significant.** After picking, nothing showed the order needed a package; the only way on was ticking lines on the order page | **Fixed.** Pack & ship lists "Picked, waiting for a package" with a Create package button, and the Overview counts it |
| W-15 / W-25 | Order page | Mark RTO, Refund, Exchange and Cancel were offered where they cannot apply (unshipped, already shipped, already cancelled) | **Fixed.** Each action is offered only in the states it applies to |
| W-16 | Package actions | Every package action was shown at once | **Fixed.** Only the next step(s) are shown, the first highlighted, with a line saying what comes next |
| W-17 | Pack dialog and messages | The refusal was shown twice; the scan list showed bare barcodes; success messages were generic ("Mark packed: done.") | **Fixed.** One message. Scans are named per item ("Pique Polo · Navy · M — 1 of 1 scanned"), with a warning for a unit not in the package. Each step has its own message saying what comes next |
| W-18 | Packing slip and label | With no warehouse address set, both printed without a return address and gave no warning | **Fixed.** A no-print warning links to Business & warehouse |
| W-19 | Booking | "must be READY_TO_SHIP first" (internal status name) | **Fixed.** "Mark the package ready to ship before booking it with a courier; it is packed now." |
| W-20 | Package dialogs | A refusal from one action reappeared inside the next action's dialog | **Fixed** |
| W-21 | Pack & ship | Opened filtered to Pending only, so packed, ready and booked parcels were hidden | **Fixed.** It now opens on "In progress (not yet with the courier)" |
| W-22 | Poll tracking | Answered only "Carrier tracking polled." | **Fixed.** It now says how many parcels were checked, and their states. The Shipment column still says "Booked" after handover: the shipment's own status moves when the courier reports movement, which needs a courier (LR-008) and the AO-D5 decision |
| W-23 | Staff | **Significant.** There is no screen to add staff, give them roles, deactivate them or reset a password. The API exists; its comment promised an admin screen that was never built. Without it, independent approval needs someone to use the API | **Report.** Needs your go-ahead to build |
| W-24 | Approvals | A waiting request showed nowhere until the approver opened Approvals | **Fixed.** The Overview shows "Approvals waiting for you" to anyone who can be named as an approver |

## Not changed, and why

- **AO-D5 (booking vs handover).** Your reviewer recommended option B on
  2026-10-05 as a recommendation, not an approval. It is recorded that
  way in `blueprint/DECISION_REGISTER.md`. The package still becomes
  SHIPPED, and stock still leaves the ledger, at booking. Moving that
  waits for your approval.
- **AO-D6 (photo metadata).** Your reviewer recommended stripping it
  automatically on 2026-10-05. It is recorded as a recommendation, and
  uploads are still stored as uploaded.
- **Courier (LR-008).** Still not chosen. Real labels, pickup,
  cancellation, the delivery-area list (W-11) and live tracking (W-22)
  all depend on it.
- **Staff screen (W-23).** It is new scope, so it waits for your
  go-ahead rather than being added here.

## Tests

- **Integration (`admin-queries.test.ts`).** A new test follows one
  parcel from picked to handed over and checks three things at each
  stage:
  - the "Picked, waiting for a package" list;
  - the "In progress" filter;
  - the Overview's dispatch counts.

  The workload test now covers the new sections and the
  approvals-waiting tile.
- **Browser (`p1-console.spec.ts`, AO-10).** Now checks that a wrong unit
  at pack is named, can be undone, and that the right unit shows as
  "1 of 1 scanned".
- **Updated wording.** Tests that checked the old wording were changed
  to the new messages without loosening the checks:
  - `grn-adversarial.test.ts`;
  - `approvals.spec.ts`;
  - `p1-console.spec.ts`.
