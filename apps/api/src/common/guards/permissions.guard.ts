import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, PermissionType } from '../constants/permissions.constants';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Centralizes Role -> Permission checks (master doc §13) instead of each
 * controller re-deriving "which roles can do this" independently. Unlike
 * RolesGuard, there is no implicit SUPER_ADMIN bypass: a role only passes
 * when its explicit entry in ROLE_PERMISSIONS (see permissions.constants.ts)
 * contains every required permission. Routes without @RequirePermissions()
 * are unaffected by this guard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionType[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      return false;
    }

    return requiredPermissions.every((permission) => roleHasPermission(user.role, permission));
  }
}
