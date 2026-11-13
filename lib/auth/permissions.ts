/** Permission keys. Mirrors the `permissions` table seeded in the tenancy migration. */
export const PERMISSIONS = [
  "dashboard.view",
  "sales.create",
  "sales.view_own",
  "sales.view_all",
  "sales.cancel",
  "sales.credit_note",
  "sales.discount",
  "sales.price_override",
  "products.view",
  "products.manage",
  "products.view_cost",
  "inventory.view",
  "inventory.adjust",
  "customers.view",
  "customers.manage",
  "vendors.manage",
  "purchases.view",
  "purchases.create",
  "purchases.post",
  "shipments.view",
  "shipments.create",
  "shipments.update",
  "reports.view",
  "reports.export",
  "staff.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionSet = ReadonlySet<string>;

/** True when the set contains the permission (or ANY of the permissions, for an array). */
export function can(perms: PermissionSet | readonly string[], perm: Permission | readonly Permission[]): boolean {
  const set = perms instanceof Set ? perms : new Set(perms as readonly string[]);
  return Array.isArray(perm) ? perm.some((p) => set.has(p)) : set.has(perm as Permission);
}
