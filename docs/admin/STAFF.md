# Staff management (AO-D7)

Status: IMPLEMENTED on `claude/admin-ops-phase1`, awaiting review.
Authorized by the Product Owner on 2026-10-06 ("Build staff management
with temporary passwords shown once and mandatory password change before
further access. Revoke sessions after password reset, deactivation or
role changes. Protect the last Super Admin and configured owner.").
Decision record: `blueprint/DECISION_REGISTER.md` → AO-D7.

## Who can use it

The **Staff** page (Dashboard → Staff) and every `/staff` route need
`rbac:manage`, which only the Super Admin role has by default.

## What the page does

| Action | What happens |
|---|---|
| **Add a person** | Name, email and at least one role. A random 16-character temporary password is shown **once** on the page (no 0/O/1/l/I). It is not stored, logged or audited in plain text. |
| **Change roles** | Takes effect at once and signs the person out everywhere; they see the new roles at their next sign-in. |
| **Reset password** | A new temporary password is shown once; the person is signed out everywhere and must choose a new password at the next sign-in. |
| **Deactivate** | The person is signed out everywhere and cannot sign in. Their history stays. |
| **Reactivate** | They can sign in again with their existing password. |

The list shows each person's roles, status, last sign-in, whether they
still have a temporary password, and whether they are an approval owner.

## First sign-in with a temporary password

Sign-in succeeds, but every route except "who am I", sign-out and
**Choose your own password** answers `403 PASSWORD_CHANGE_REQUIRED`, and
the console shows only the password page. The new password needs at
least 12 characters, letters and a number, and must differ from the
current one. Changing it (then or later, from **Change password** in the
sidebar) ends every session, including the current one, and returns a
new session, so other browsers signed in as that person are signed out.
The page then confirms the change ("Password changed") before the person
continues.

The older `POST /auth/staff/users` route (an administrator-chosen
password) now marks that password as temporary too.

## How sessions are ended

Each session records when it was issued. A reset, deactivation, role
change or own password change sets the person's `sessionsRevokedAt`, and
every request refuses a session issued before it. The Redis session keys
are also deleted, but the database check alone is enough: a key that
could not be deleted is still refused. Sign-in dates its session from the
moment it read the password, so a reset that lands during a sign-in still
ends that new session.

What the signed-out person sees: their next request is refused, and the
screen says "You are signed out: your session expired or an administrator
changed your account." with a **Sign in again in a new tab** link. The
page itself stays, so anything they had typed is kept; after signing in
in the new tab they come back and try again (added after the 2026-10-06
walkthrough, which found only a Retry link that could never succeed).

## Protections

- The **last active Super Admin** cannot be deactivated or lose the Super
  Admin role.
- A **configured approval owner** (Approvals → owner approval) cannot be
  deactivated or have their roles changed until they are removed as an
  owner.
- Nobody changes their own roles, deactivates themselves or resets their
  own password here (they use Change password).
- These checks and the changes run under one database advisory lock, so
  two administrators deactivating each other at the same moment cannot
  leave no Super Admin.

Every action is audited (`staff_user.create`, `.roles`, `.deactivate`,
`.reactivate`, `.password_reset`, `.password_change`), without passwords.
Request logs redact `temporaryPassword`, `currentPassword` and
`newPassword`.

## Not included

- Inviting by email or SMS (there is no messaging provider yet, LR-008):
  the administrator passes the temporary password on in person.
- Self-service "forgot password" for staff.
- Editing a person's name or email after creation.

## Tests

- `services/commerce-api/test/integration/staff-management.test.ts`:
  temporary password shown once and absent from storage, list and audit;
  `rbac:manage` on every route; only the password change is allowed with a
  temporary password; password rules; the change ends the old session;
  reset, deactivation and role change end sessions (including when the
  Redis key survives); the last Super Admin (including two administrators
  acting on each other at once); approval owners; the older create route.
- Browser flow AO-12 in `test/e2e-admin/staff.spec.ts`.
