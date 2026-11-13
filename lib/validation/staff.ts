import { z } from "zod";
import { emailRequired, optionalText, percentRequired, requiredText, uuid, uuidOptional } from "./common";

const outletIds = z.array(uuid).max(500);

const needsAnOutlet = <T extends { all_outlets: boolean; outlet_ids: string[] }>(v: T) =>
  v.all_outlets || v.outlet_ids.length > 0;
const NEEDS_AN_OUTLET = { path: ["outlet_ids"], message: "Choose at least one outlet, or give access to all outlets" };

export const staffInviteSchema = z
  .object({
    full_name: optionalText(100),
    email: emailRequired,
    role_id: uuid,
    all_outlets: z.boolean(),
    outlet_ids: outletIds,
  })
  .refine(needsAnOutlet, NEEDS_AN_OUTLET);

export const memberRoleSchema = z.object({ member_id: uuid, role_id: uuid });

export const memberOutletsSchema = z
  .object({ member_id: uuid, all_outlets: z.boolean(), outlet_ids: outletIds })
  .refine(needsAnOutlet, NEEDS_AN_OUTLET);

export const memberActiveSchema = z.object({ member_id: uuid, is_active: z.boolean() });

export const invitationIdSchema = z.object({ invitation_id: uuid });

export const roleCreateSchema = z.object({
  name: requiredText("Role name", 60),
  copy_from: uuidOptional,
});

export const roleSaveSchema = z.object({
  role_id: uuid,
  /** Ignored for system roles (they cannot be renamed). */
  name: requiredText("Role name", 60),
  max_discount_percent: percentRequired,
  /** Ignored for system roles (their permissions are fixed). */
  permissions: z.array(z.string().trim().min(1).max(60)).max(200),
});

export const roleIdSchema = z.object({ role_id: uuid });

export type StaffInviteInput = z.input<typeof staffInviteSchema>;
export type RoleCreateInput = z.input<typeof roleCreateSchema>;

/** Permissions that let someone change who can do what. Granting them deserves a warning. */
export const ADMIN_PERMISSIONS: readonly string[] = ["staff.manage", "settings.manage"];
