export type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'platform_owner';

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  platform_owner: 100,
  owner: 75,
  admin: 50,
  member: 25,
  viewer: 10,
};
