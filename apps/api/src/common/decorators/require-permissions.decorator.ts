import { SetMetadata } from '@nestjs/common';
import { PermissionType } from '../constants/permissions.constants';

export const PERMISSIONS_KEY = 'permissions';

/** Restricts a route to callers whose role carries every listed permission (see PermissionsGuard). */
export const RequirePermissions = (...permissions: PermissionType[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
