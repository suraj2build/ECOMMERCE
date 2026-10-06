# Desktop walkthrough: staff, booking, handover, cancellation (2026-10-06)

Asked for by the Product Owner after the report on `a807ef6`: a desktop
walkthrough of temporary-password sign-in, session revocation, booking
without stock movement, handover posting once and cancellation releasing
stock, plus a recovery path for an exchange replacement booked by mistake
(built first; see `docs/admin/DISPATCH.md` → "A replacement booked by
mistake").

## How it was run

- **Setup.** A browser (1440 × 900) drove the production build of the
  API, storefront and admin (`NODE_ENV=production`,
  `DEPLOYMENT_STAGE=preview`) on their own fresh database, loaded with the
  demo catalogue. The demo and test databases were not touched. The
  courier is the built-in mock (`MOCK`); no real courier is chosen
  (LR-008).
- **People.** The owner (Super Admin) and two people the owner added on
  the Staff page: Ravi (Warehouse Manager) and Asha (Customer Service),
  each in their own browser.
- **Data.** Everything went through the screens. Two exceptions:
  - the demo warehouse has no address, and booking refuses without one,
    so a clearly fictitious test address was entered on Business &
    warehouse in this throwaway database only;
  - stock, sale and audit rows were read straight from the database after
    each step to check the numbers (read only).
- **Record.** Screenshots are kept outside the repository. Temporary
  passwords were masked before each screenshot.

## 1. Staff: temporary password and forced change

| Check | Result |
|---|---|
| Add a person | **Add person** stays disabled until a role is ticked. The temporary password (16 characters) is shown once; after "I have passed it on" and after a reload it is gone. |
| Same email again, different case | Refused: "Someone already has a staff account with this email". |
| List | The new row reads "Temporary password not changed yet". |
| Audit | `staff_user.create` records the roles and `temporaryPassword: true`, never the value. |
| First sign-in | Lands on **Choose your own password**. Going to Orders sends them back. A direct API call answers `403 PASSWORD_CHANGE_REQUIRED`. |
| Weak password | A 6-character password is stopped by the field (12 minimum); a letters-only one by the server (covered by the browser test AO-12). |
| Temporary password reused as the new one | Refused: "Choose a password different from the current one". |
| After the change | The person reaches the Overview with their role's menu only. |

## 2. Session revocation

| Owner action | What Ravi saw | Result |
|---|---|---|
| Change roles (add Customer Service) | Next page: signed out | Signed in again, the menu included the Customer Service sections. |
| Reset password | Next page: signed out | The old password was refused; the new temporary one led to the forced change again. |
| Ravi changes his own password | His second browser: signed out | The browser he changed it in stayed signed in. |
| Deactivate | Next page: signed out | Sign-in refused. The message is the same as for a wrong password, so it does not reveal the account exists; the owner's screen says the person was deactivated. |
| Reactivate | — | Sign-in works again. |

The owner's own row offers no actions ("Change your own password from
the sidebar"). At the end Ravi had 8 sessions on record and 1 active; the
audit trail held `create`, `password_change`, `roles`, `password_reset`,
two more `password_change`, `deactivate` and `reactivate`, in that order.

## 3. Booking, handover and cancellation: stock at each step

Product: A-Line Midi Skirt (demo catalogue), cash-on-delivery orders
placed on the storefront by guests.

| Order | Step | On hand | Reserved | SALE rows |
|---|---|---|---|---|
| ORD-1 (size M) | placed | 29 | 1 | 0 |
| | picked, packed, ready, **booked** | 29 | 1 | 0 |
| | **handover** confirmed on Courier handover | 28 | 0 | 1 |
| | carrier tracking polled ("no new updates") | 28 | 0 | 1 |
| | marked delivered | 28 | 0 | 1 |
| ORD-2 (size S) | placed | 28 | 1 | 0 |
| | **booked** | 28 | 1 | 0 |
| | **Cancel booking** (courier cancellation ticked, reason, reference) | 28 | 0 | 0 |
| ORD-3 (size M, after the fixes) | **booked** | 29 | 1 | 0 |
| | **handover** | 28 | 0 | 1 |

(M is 29 again before ORD-3 because ORD-1's original item came back
through the exchange below and passed QC.)

After the cancellation, ORD-2's order, line, package and shipment were
all `CANCELLED`, the courier reference was kept, and the handover list
was empty. Booking showed "Booked — awaiting collection" and the
confirmation said the stock stays reserved until collection. The handover
manifest listed both booked parcels; confirming one recorded "1 parcel
recorded as handed over and marked shipped." The guests got no shipped
message (only account holders do, as designed).

## 4. Exchange replacement booked by mistake

On delivered ORD-1, an exchange from M to L was requested, received and
passed QC, and the replacement was picked, packed and booked. Then:

| Step | L on hand | L reserved | EXCHANGE_DISPATCH | Exchange |
|---|---|---|---|---|
| Allocated after QC | 4 | 1 | 0 | Replacement allocated |
| Booked | 4 | 1 | 0 | Replacement allocated |
| **Cancel booking** from the exchange | 4 | 1 | 0 | Replacement allocated |
| New package created, packed, booked | 4 | 1 | 0 | Replacement allocated |
| **Handover** | 3 | 0 | 1 | Replacement allocated |
| Marked delivered | 3 | 0 | 1 | Completed |

The cancel dialog says the exchange is not cancelled and the replacement
stays allocated. Afterwards the exchange page lists the cancelled booking
with its courier reference, and Pack & ship lists the cancelled package
against the exchange. The same path ran again after the fixes on ORD-3 (L 3 → 2,
one dispatch).

## Findings, fixed in this pass

| # | Screen | What was wrong | Now |
|---|---|---|---|
| W2-1 | Any page, after revocation | The signed-out person kept the page with "Your session has expired… Retry"; Retry could never succeed. | "You are signed out: your session expired or an administrator changed your account." with **Sign in again in a new tab**; the page keeps what was typed. |
| W2-2 | Change password | No confirmation; it jumped to the Overview. | "Password changed" screen saying other browsers were signed out, then **Continue**. |
| W2-3 | Order page | "Fulfilment created." stayed at the top through packing, readiness and booking. | Cleared when a package step runs; the package shows its own message. |
| W2-4 | Order page, booked line | Said "cancel from Pack & ship" while **Cancel booking** is on the package just below. | "to cancel, use Cancel booking on its package below". |
| W2-5 | Order page, package | The courier reference appeared on the "Shipped" row before anything shipped. | Shown on that row only once shipped (it stays on the Carrier shipment row). |
| W2-6 | Order page, Pack & ship, exchange page; storefront order page | After a staff-confirmed handover the carrier's own status stays `BOOKED` until the carrier reports, so the badge still read "Booked — awaiting collection" on a shipped or delivered package; the shopper saw "Shipped … — Booked with carrier". | The admin shows "Handed over"; the shopper sees "With the courier" while shipped and no carrier status once delivered. |
| W2-7 | Exchange page | After cancelling a replacement booking, the confirmation disappeared with the package and an old "Create replacement package: done." remained. | The confirmation is shown at page level. |
| W2-8 | Exchange page | Schedule pickup, Mark picked up, Mark received, Record QC and Cancel exchange were offered at every status (the server refused them); "Create replacement package" and the outside-the-pipeline recovery were offered before allocation and after completion. | Only actions valid for the current status; "Pick the replacement first" before the package; the recovery only while allocated. |
| W2-9 | Order page and Pack & ship, cancelled replacement package | Said the replacement "is still allocated" even after the exchange completed. | "…cancelled before collection; nothing left stock. The exchange page shows its current package." (Pack & ship: "booking cancelled before collection".) |

## Reported, not changed

- **Courier (LR-008).** Booking, labels, pickup, tracking and
  cancellation all run against the mock courier. Real labels, pickup
  booking, tracking and courier-side cancellation need the chosen
  courier's integration.
- **An order package booked by mistake** can only be cancelled whole
  (its items are cancelled and the stock released). There is no "cancel
  the booking but keep the order and rebook" path for order packages,
  unlike the exchange replacement path built now. Whether one is wanted
  is a Product Owner question.
- **Changing an exchange's replacement item** after allocation has no
  path (an exchange can only be cancelled before its original item is
  received).
- **Admin favicon.** Every admin page logs a 404 for `/favicon.ico`. No
  icon was added, since none has been supplied.
- The Returns page's actions were not reviewed for status in this pass.

Not self-certified; no go-live claimed.
