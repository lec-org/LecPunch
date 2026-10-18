import { UserRole } from '@lecpunch/shared';

export interface AuthUser {
  userId: string;
  teamId: string;
  role: UserRole;
  username: string;
  displayName: string;
  enrollYear: number;
  tokenExpiresAt?: number;
}
