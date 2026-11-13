"use server";

import { revalidatePath } from "next/cache";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import { uuid } from "@/lib/validation/common";
import { customerSchema } from "@/lib/validation/parties";

interface DbError {
  message?: string;
  code?: string;
  details?: string | null;
}

/** Point a duplicate phone number at the phone field instead of a generic toast. */
function throwCustomerError(error: DbError): never {
  const message = describeDbError(error);
  if (error.code === "23505" && /customers_phone_uniq/.test(`${error.message ?? ""} ${error.details ?? ""}`)) {
    throw new ActionError(message, { phone: [message] });
  }
  throw new ActionError(message);
}

/** Create (id = null) or update a customer. `whatsapp_opt_in_at` is stamped by a database trigger. */
export async function saveCustomerAction(id: string | null, input: unknown) {
  return runAction(customerSchema, input, { perm: "customers.manage" }, async (data, ctx) => {
    if (id === null) {
      const { data: row, error } = await ctx.supabase
        .from("customers")
        .insert({ ...data, business_id: ctx.business.id, created_by: ctx.user.id })
        .select("id")
        .single();
      if (error) throwCustomerError(error);
      revalidatePath("/app/customers");
      return { id: (row as { id: string }).id };
    }

    if (!uuid.safeParse(id).success) throw new ActionError("Customer not found");
    const { data: row, error } = await ctx.supabase
      .from("customers")
      .update(data)
      .eq("id", id)
      .eq("business_id", ctx.business.id)
      .select("id")
      .maybeSingle();
    if (error) throwCustomerError(error);
    if (!row) throw new ActionError("Customer not found");
    revalidatePath("/app/customers");
    revalidatePath(`/app/customers/${id}`);
    return { id };
  });
}

/** Delete a customer. Bills keep their own copy of the customer's details. */
export async function deleteCustomerAction(id: string) {
  return runAction(uuid, id, { perm: "customers.manage" }, async (customerId, ctx) => {
    const result = await ctx.supabase
      .from("customers")
      .delete()
      .eq("id", customerId)
      .eq("business_id", ctx.business.id)
      .select("id");
    if (result.error && /posted invoice cannot be edited/i.test(result.error.message ?? "")) {
      // The invoice immutability trigger rejects unlinking the customer from posted bills.
      throw new ActionError(
        "This customer has bills, so the record cannot be deleted. You can still edit their details; past bills are not affected.",
      );
    }
    const rows = unwrap(result) as { id: string }[] | null;
    if (!rows?.length) throw new ActionError("Customer not found");
    revalidatePath("/app/customers");
  });
}
