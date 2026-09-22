import type { PrismaClient } from '@fcp/db';
import type { PermissionKey, RoleKey } from '@fcp/shared';

/**
 * Resolves a staff user's effective permission set from the database
 * (StaffUser -> StaffUserRole -> Role -> RolePermission -> Permission).
 * Always resolved fresh per-request (memoized once per request via
 * request.staffPermissions in the auth plugin) rather than cached in the
 * session token, so a role/permission change takes effect immediately -
 * correctness over micro-optimization for Phase 1 scale.
 */
export async function resolveStaffPermissions(
  prisma: PrismaClient,
  staffUserId: string,
): Promise<{ permissions: Set<PermissionKey>; roles: RoleKey[]; isActive: boolean }> {
  const staffUser = await prisma.staffUser.findUnique({
    where: { id: staffUserId },
    include: {
      roles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
    },
  });

  if (!staffUser) {
    return { permissions: new Set(), roles: [], isActive: false };
  }

  const permissions = new Set<PermissionKey>();
  const roles: RoleKey[] = [];
  for (const staffRole of staffUser.roles) {
    roles.push(staffRole.role.key as RoleKey);
    for (const rolePermission of staffRole.role.permissions) {
      permissions.add(rolePermission.permission.key as PermissionKey);
    }
  }

  return { permissions, roles, isActive: staffUser.isActive };
}
