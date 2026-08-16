export const ADMIN_SECTIONS = ['songs', 'activities', 'people', 'settings'] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export type AccessLevel = 'read' | 'write';

export type UserPermissions = Record<AdminSection, AccessLevel | null>;

export const SECTION_LABELS: Record<AdminSection, string> = {
  songs: 'Canciones',
  activities: 'Actividades',
  people: 'Personas',
  settings: 'Ajustes',
};

export function emptyPermissions(): UserPermissions {
  return {
    songs: null,
    activities: null,
    people: null,
    settings: null,
  };
}

export function fullWritePermissions(): UserPermissions {
  return {
    songs: 'write',
    activities: 'write',
    people: 'write',
    settings: 'write',
  };
}

export function normalizeAccess(value: unknown): AccessLevel | null {
  if (value === 'read' || value === 'write') return value;
  return null;
}

export function accessRank(access: AccessLevel | null | undefined): number {
  if (access === 'write') return 2;
  if (access === 'read') return 1;
  return 0;
}

export function hasAccess(
  permissions: UserPermissions | null | undefined,
  section: AdminSection,
  needed: AccessLevel
): boolean {
  if (!permissions) return false;
  return accessRank(permissions[section]) >= accessRank(needed);
}

export function permissionsFromRows(
  rows: Array<{ section: string; access: string }>
): UserPermissions {
  const permissions = emptyPermissions();
  for (const row of rows) {
    if ((ADMIN_SECTIONS as readonly string[]).includes(row.section)) {
      permissions[row.section as AdminSection] = normalizeAccess(row.access);
    }
  }
  return permissions;
}

export function parsePermissionsFromBody(body: Record<string, unknown>): UserPermissions {
  const permissions = emptyPermissions();
  for (const section of ADMIN_SECTIONS) {
    const raw = body[`perm_${section}`];
    permissions[section] = normalizeAccess(typeof raw === 'string' ? raw : null);
  }
  return permissions;
}

export function hasAnyAccess(permissions: UserPermissions | null | undefined): boolean {
  if (!permissions) return false;
  return ADMIN_SECTIONS.some((section) => accessRank(permissions[section]) > 0);
}
