# Approvals (AO-D4)

Status: IMPLEMENTED on `claude/admin-ops-phase1`, awaiting implementation
review. Decided by the Product Owner on 2026-10-05:

> Add an explicit owner policy with reasons, audit history and stronger
> confirmation for sensitive actions. Keep independent approval available
> for future staff. Apply one consistent approval policy across PO,
> adjustments, receiving and picking; don't leave accidental self-approval
> in one route while blocking it elsewhere.

## The rule

Four actions need a second person. They all go through one check,
`ApprovalPolicyService.decide` (`services/commerce-api/src/modules/approvals/service.ts`):

| Action | When | Approving permission | Requester |
|---|---|---|---|
| Purchase order approval | every PO | `po:approve` | whoever submitted it |
| Stock adjustment | at/above `INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS` (50) | `inventory:adjust:coapprove` | whoever posts it |
| Receiving QC sign-off | damaged + rejected at/above `GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS` (20) on a line | `grn:qc:manager_signoff` | whoever records the receipt |
| Pick shortfall write-off | at/above the stock-adjustment threshold | `inventory:adjust:coapprove` | the picker |

1. The approver must be an active staff member who holds the approving
   permission (checked in the service, not only the route).
2. The approver must be someone other than the requester, and **they
   approve it themselves, from their own login** (see "Approval requests"
   below). **This is the default and always remains available.**
3. The only exception is **owner approval**. It applies when all of these
   are true:
   - an `org:manage` holder has switched it on, on the Approvals page (admin menu, next to Setup & health);
   - the requester is named there as an owner;
   - they hold the approving permission;
   - they give a reason of at least 10 characters;
   - they re-enter their password (plus their authenticator code if they
     use MFA).

A named co-approver is checked whenever one is given, even below the
threshold. `decide` is given the person acting as well as the approver, and
refuses an independent approval unless the approver is the person acting;
an approval given on someone else's behalf is impossible in the service, not
only in the admin. Every approval, independent or self, is written to
`approval_records` in the same transaction as the action. A self-approval
also writes an `approval.self_approved` audit row.

The database enforces the record's shape with a check constraint. A
self-approval always has the same requester and approver and a non-empty
reason. An independent approval always has two different people.

## Approval requests (independent approval)

Product Owner review of `3e1149a`: choosing another person's name only
recorded attribution; it did not prove they approved. Adjustments,
receiving and picking now use a queue (`services/commerce-api/src/modules/approvals/queue.ts`,
table `approval_requests`).

1. **Requesting.** When the requester names someone else, nothing is
   applied. The API answers `202 {pendingApproval}` and stores the
   request: what was asked (the full payload), a readable summary, the
   requester, and the named approver. The approver must hold the approving
   permission and be someone other than the requester. Sending the same
   request again returns the same open request; a different request for
   the same subject while one is open is refused (409). The subject is the
   adjustment's idempotency key or the pick task. A receipt has no subject
   key: two receipts for one PO can wait at once, and each is checked
   against the PO's remaining quantities when it is approved.
2. **Approving.** Only the named approver can approve, from their own
   login (`POST /approvals/requests/:id/approve`). The action then runs
   **as the requester**, with the approval passed in, and is re-validated
   at that moment: stock levels, pick state and PO lines are read afresh,
   and the requester must still hold the permission to make the request.
   The request is claimed inside the action's own transaction, with the
   approval record linked to it (`approval_records.approvalRequestId`), so
   the action, the approval and the request's status commit together.
   Two approvals at the same moment apply it once; the others get 409.
3. **When the action is no longer possible** (for example the stock to be
   written off has since left), the request becomes `FAILED` with the
   reason, and nothing is applied. If the approver has lost the approving
   permission, approval is refused and the request stays open.
4. **Rejecting** needs a note of at least 3 characters, which the
   requester sees. **Withdrawing** is for the requester only.
5. **While a pick shortfall waits**, the pick cannot be recorded another
   way; the picks screen shows who it is waiting for. Withdrawing the
   request releases it.

The database holds the rules as checks: the requester and approver differ;
only the approver decides APPROVED, REJECTED or FAILED, and only the
requester cancels; a rejection has a note and a failure a reason; at most
one open request per subject; and a record linked to a request is never a
self-approval. Every step is audited (`approval.requested`, `.approved`,
`.rejected`, `.cancelled`, `.failed`).

**Owner self-approval stays a separate, immediate path.** Choosing
yourself under owner approval applies the action at once with the reason
and password, exactly as before; it never creates a request.

**Purchase orders** already worked this way: a PO is submitted, then the
approver approves it from their own login on the PO page. They do not use
the queue.

In the admin, the **Approvals** page shows "Waiting for your approval"
(approve, or reject with a note) and "Requests you sent" (status, notes,
withdraw). It is in the menu for anyone who can request or approve.
`box=all` (every request) needs `org:manage` or `audit:read`.

## What changed in behaviour

- **Purchase orders.** These were refused for the submitter at any value,
  with no way through. They are still refused unless owner approval
  applies.
- **Stock adjustments.** The same-person check moved from the route into
  the shared policy. The behaviour is unchanged when owner approval is off.
- **Receiving QC sign-off.** This used to accept the receiver signing off
  their own QC failure. It no longer does, unless owner approval applies.
  The receiver had only needed to hold `grn:qc:manager_signoff`.
- **Pick shortfall.** This was the gap found in Phase 1. The co-approver
  was never checked at all: any staff id was accepted, including the
  picker's own. The co-approver now must hold `inventory:adjust:coapprove`
  and be someone else, unless owner approval applies.

## Confirmation and limits

- The password (and code) is verified against the signed-in person. A
  failure is audited as `approval.confirmation_failed`.
- After 5 failures in 15 minutes, further confirmations by that person are
  refused until the window passes.
- The admin never keeps a typed password or authenticator code after an
  attempt. After a refusal the dialog stays open with the reason (and any
  comment) still filled in, but the password and code are cleared. They
  are also cleared on success, when the dialog is closed, and when the
  fields are hidden (for example, another approver is chosen).
- Changing the policy also needs `org:manage` and the person's password.
  It is audited as `approval_policy.update` with the before and after
  owners.

## Admin

- **The Approvals page** (admin menu, next to Setup & health) shows the rule, owner approval on or off, the
  owners, and who last changed it. It also has the **approval log**, which
  can be filtered to self-approvals only.
- The log is visible with `org:manage` or `audit:read`.
- Co-approver and sign-off pickers list the signed-in person as
  "(me, owner approval)" only while owner approval lets them approve their
  own work.
- Choosing yourself, or approving a PO you submitted, shows a section for
  the reason and password. If owner approval is off, it instead explains
  that someone else must approve.

## Tests

- `services/commerce-api/test/integration/approvals.test.ts` covers:
  - policy access and auditing;
  - the confirmation limit, including a burst of simultaneous wrong
    passwords (exactly 5 are checked, the rest refused);
  - approval requests: queued not applied, only the named approver
    approves, simultaneous approvals apply once, rejection and withdrawal,
    re-validation at approval (FAILED with the reason), approver who lost
    the permission, the database rules, and `decide` refusing an approval
    on someone else's behalf;
  - a queued receipt, and a pick held while its request is open;
  - the database check;
  - each of the four actions, off and on;
  - non-owners;
  - the picker list.
- `test/e2e-admin/approvals.spec.ts` (AO-09) covers, in the browser:
  - turning owner approval on;
  - approving one's own PO;
  - the log.
- `test/e2e-admin/p1-console.spec.ts` (AO-11) covers, in the browser: a
  warehouse manager requests a large adjustment naming Finance; stock does
  not move; Finance approves it on their own Approvals page; stock moves
  and the ledger names Finance as co-approver; the requester sees
  "Approved".

## Known limits

- The approver is not notified outside the admin (no email or SMS); they
  see the request on their Approvals page. Messaging staff is not built.
- A request does not expire; it stays open until approved, rejected or
  withdrawn.
- A confirmation code from an authenticator app can be reused within its
  30-second window, at sign-in and here. That is how sign-in already
  worked; recording used codes would close it.
- There is no weekly self-approval report yet; the log filter covers it.
