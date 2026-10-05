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
2. The approver must be someone other than the requester. **This is the
   default and always remains available.**
3. The only exception is **owner approval**. It applies when all of these
   are true:
   - an `org:manage` holder has switched it on, on the Approvals page (admin menu, next to Setup & health);
   - the requester is named there as an owner;
   - they hold the approving permission;
   - they give a reason of at least 10 characters;
   - they re-enter their password (plus their authenticator code if they
     use MFA).

A named co-approver is checked whenever one is given, even below the
threshold. Every approval, independent or self, is written to
`approval_records` in the same transaction as the action. A self-approval
also writes an `approval.self_approved` audit row.

The database enforces the record's shape with a check constraint. A
self-approval always has the same requester and approver and a non-empty
reason. An independent approval always has two different people.

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
  - the confirmation limit;
  - the database check;
  - each of the four actions, off and on;
  - non-owners;
  - the picker list.
- `test/e2e-admin/approvals.spec.ts` (AO-09) covers, in the browser:
  - turning owner approval on;
  - approving one's own PO;
  - the log.

## Known limits

- A named co-approver for adjustments, receiving and picking is **recorded,
  not asked**. The requester picks them from the list, and they do not
  themselves confirm in the system. This is how the P1 console already
  worked. A request-and-approve queue, where the approver confirms from
  their own login, would be the next step if staff are added. PO approval
  is already done by the approver from their own login.
- There is no weekly self-approval report yet; the log filter covers it.
