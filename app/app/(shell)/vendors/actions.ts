"use server";

import { revalidatePath } from "next/cache";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import { uuid } from "@/lib/validation/common";
import { vendorSchema } from "@/lib/validation/parties";

interface DbError {
  message?: string;
  code?: string;
  details?: string | null;
}

/** Point a duplicate GSTIN at the GSTIN field instead of a generic toast. */
function throwVendorError(error: DbError): never {
  const message = describeDbError(error);
  if (error.code === "23505" && /vendors_gstin_uniq/.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
    throw new ActionError(message, { gstin: [message] });
  }
  throw new ActionError(message);
}

/** Create (id = null) or update a vendor. */
export async function saveVendorAction(id: string | null, input: unknown) {
  return runAction(vendorSchema, input, { perm: "vendors.manage" }, async (data, ctx) => {
    if (id === null) {
      const { data: row, error } = await ctx.supabase
        .from("vendors")
        .insert({ ...data, business_id: ctx.business.id, created_by: ctx.user.id })
        .select("id")
        .single();
      if (error) throwVendorError(error);
      revalidatePath("/app/vendors");
      return { id: (row as { id: string }).id };
    }

    if (!uuid.safeParse(id).success) throw new ActionError("Vendor not found");
    const { data: row, error } = await ctx.supabase
      .from("vendors")
      .update(data)
      .eq("id", id)
      .eq("business_id", ctx.business.id)
      .select("id")
      .maybeSingle();
    if (error) throwVendorError(error);
    if (!row) throw new ActionError("Vendor not found");
    revalidatePath("/app/vendors");
    revalidatePath(`/app/vendors/${id}`);
    return { id };
  });
}

/** Delete a vendor that no purchase bill uses. Vendors with bills must be deactivated instead. */
export async function deleteVendorAction(id: string) {
  return runAction(uuid, id, { perm: "vendors.manage" }, async (vendorId, ctx) => {
    const result = await ctx.supabase
      .from("vendors")
      .delete()
      .eq("id", vendorId)
      .eq("business_id", ctx.business.id)
      .select("id");
    if (result.error?.code === "23503") {
      throw new ActionError(
        "This vendor has purchase bills, so it cannot be deleted. Untick Active and save to stop using it instead.",
      );
    }
    const rows = unwrap(result) as { id: string }[] | null;
    if (!rows?.length) throw new ActionError("Vendor not found");
    revalidatePath("/app/vendors");
  });
}
