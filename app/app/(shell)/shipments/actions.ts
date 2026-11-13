"use server";

import { revalidatePath } from "next/cache";
import { ActionError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { ilikeTerm } from "@/lib/list";
import { BUCKETS } from "@/lib/storage";
import { isReceiptPathFor, MAX_RECEIPT_PHOTOS, shipmentStatusLabel, type InvoiceMatch } from "@/lib/shipments";
import {
  invoiceSearchSchema,
  shipmentAddPhotosSchema,
  shipmentCreateSchema,
  shipmentDetailsSchema,
  shipmentRemovePhotoSchema,
  shipmentStatusSchema,
} from "@/lib/validation/shipments";

const INVOICE_COLUMNS =
  "id, invoice_number, invoice_date, customer_name, customer_phone, customer_address, customer_pincode, customer_state_code, total_paise";

function assertPhotoPaths(ctx: AppContext, paths: string[]) {
  for (const path of paths) {
    if (!isReceiptPathFor(ctx.business.id, path)) throw new ActionError("One of the photos does not belong to this business");
  }
}

/** The partner must belong to this business. Inactive partners cannot be picked for a new choice. */
async function assertCourier(ctx: AppContext, courierId: string | null, allowInactiveId?: string | null) {
  if (!courierId) return;
  const { data } = await ctx.supabase
    .from("courier_partners")
    .select("id, is_active")
    .eq("id", courierId)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  const partner = data as { id: string; is_active: boolean } | null;
  if (!partner) throw new ActionError("That courier partner was not found", { courier_partner_id: ["Pick a courier partner"] });
  if (!partner.is_active && partner.id !== allowInactiveId) {
    throw new ActionError("That courier partner is no longer active", { courier_partner_id: ["Pick an active courier partner"] });
  }
}

/** Bills the user is allowed to see (RLS decides), matched by number, for the picker on the form. */
export async function searchInvoicesForShipmentAction(input: unknown) {
  return runAction(invoiceSearchSchema, input, { perm: "shipments.create" }, async (data, ctx) => {
    const term = ilikeTerm(data.q);
    if (!term) return [] as InvoiceMatch[];
    const { data: rows } = await ctx.supabase
      .from("sales_invoices")
      .select(INVOICE_COLUMNS)
      .eq("business_id", ctx.business.id)
      .eq("status", "posted")
      .ilike("invoice_number", `%${term}%`)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8);
    return (rows ?? []) as InvoiceMatch[];
  });
}

export async function createShipmentAction(input: unknown) {
  return runAction(shipmentCreateSchema, input, { perm: "shipments.create" }, async (data, ctx) => {
    if (!ctx.outlet) throw new ActionError("Pick an outlet first");
    assertPhotoPaths(ctx, data.receipt_photo_paths);
    await assertCourier(ctx, data.courier_partner_id);

    // Link the bill only when this user can actually read it; the customer comes from the bill, never from the client.
    let outletId = ctx.outlet.id;
    let customerId: string | null = null;
    if (data.invoice_id) {
      const { data: invoiceRow } = await ctx.supabase
        .from("sales_invoices")
        .select("id, outlet_id, customer_id")
        .eq("id", data.invoice_id)
        .eq("business_id", ctx.business.id)
        .maybeSingle();
      const invoice = invoiceRow as { id: string; outlet_id: string; customer_id: string | null } | null;
      if (!invoice) {
        throw new ActionError("That bill could not be opened. Remove it and save this as a standalone shipment.", {
          invoice_id: ["This bill could not be opened"],
        });
      }
      customerId = invoice.customer_id;
      if (ctx.outlets.some((o) => o.id === invoice.outlet_id)) outletId = invoice.outlet_id;
    }

    // The id is made here so we never need to read the row back (a role may create without being able to view).
    const id = crypto.randomUUID();
    unwrap(
      await ctx.supabase.from("shipments").insert({
        id,
        business_id: ctx.business.id,
        outlet_id: outletId,
        invoice_id: data.invoice_id,
        customer_id: customerId,
        recipient_name: data.recipient_name,
        recipient_phone: data.recipient_phone,
        address_line1: data.address_line1,
        address_line2: data.address_line2,
        city: data.city,
        pincode: data.pincode,
        state_code: data.state_code,
        courier_partner_id: data.courier_partner_id,
        tracking_number: data.tracking_number,
        shipped_on: data.shipped_on,
        package_count: data.package_count,
        weight_grams: data.weight_grams,
        declared_value_paise: data.declared_value,
        receipt_photo_paths: data.receipt_photo_paths,
        notes: data.notes,
        created_by: ctx.user.id,
      }),
    );
    revalidatePath("/app/shipments");
    return { id, canView: ctx.can("shipments.view") };
  });
}

/** Status and its note are written together; a database trigger turns the change into a timeline event. */
export async function updateShipmentStatusAction(input: unknown) {
  return runAction(shipmentStatusSchema, input, { perm: "shipments.update" }, async (data, ctx) => {
    const { data: currentRow } = await ctx.supabase
      .from("shipments")
      .select("id, status")
      .eq("id", data.id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    const current = currentRow as { id: string; status: string } | null;
    if (!current) throw new ActionError("Shipment not found");
    if (current.status === data.status) {
      throw new ActionError(`This shipment is already marked ${shipmentStatusLabel(data.status)}. Refresh to see the latest.`);
    }
    const updated = unwrap(
      await ctx.supabase
        .from("shipments")
        .update({ status: data.status, last_status_note: data.note })
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        // Guards against two people changing the status at the same moment.
        .eq("status", current.status)
        .select("id"),
    ) as { id: string }[] | null;
    if (!updated?.length) throw new ActionError("Someone else just updated this shipment. Refresh and try again.");
    revalidatePath("/app/shipments");
    revalidatePath(`/app/shipments/${data.id}`);
    return { status: data.status };
  });
}

export async function updateShipmentDetailsAction(input: unknown) {
  return runAction(shipmentDetailsSchema, input, { perm: "shipments.update" }, async (data, ctx) => {
    const { data: currentRow } = await ctx.supabase
      .from("shipments")
      .select("id, courier_partner_id")
      .eq("id", data.id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    const current = currentRow as { id: string; courier_partner_id: string | null } | null;
    if (!current) throw new ActionError("Shipment not found");
    await assertCourier(ctx, data.courier_partner_id, current.courier_partner_id);

    const updated = unwrap(
      await ctx.supabase
        .from("shipments")
        .update({
          courier_partner_id: data.courier_partner_id,
          tracking_number: data.tracking_number,
          notes: data.notes,
        })
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        .select("id"),
    ) as { id: string }[] | null;
    if (!updated?.length) throw new ActionError("You don't have permission to change this shipment");
    revalidatePath("/app/shipments");
    revalidatePath(`/app/shipments/${data.id}`);
  });
}

export async function addShipmentPhotosAction(input: unknown) {
  return runAction(shipmentAddPhotosSchema, input, { perm: "shipments.update" }, async (data, ctx) => {
    assertPhotoPaths(ctx, data.paths);
    const { data: currentRow } = await ctx.supabase
      .from("shipments")
      .select("id, receipt_photo_paths")
      .eq("id", data.id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    const current = currentRow as { id: string; receipt_photo_paths: string[] | null } | null;
    if (!current) throw new ActionError("Shipment not found");
    const merged = [...new Set([...(current.receipt_photo_paths ?? []), ...data.paths])];
    if (merged.length > MAX_RECEIPT_PHOTOS) {
      throw new ActionError(`A shipment can have up to ${MAX_RECEIPT_PHOTOS} photos`);
    }
    const updated = unwrap(
      await ctx.supabase
        .from("shipments")
        .update({ receipt_photo_paths: merged })
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        .select("id"),
    ) as { id: string }[] | null;
    if (!updated?.length) throw new ActionError("You don't have permission to change this shipment");
    revalidatePath(`/app/shipments/${data.id}`);
    return { count: merged.length };
  });
}

export async function removeShipmentPhotoAction(input: unknown) {
  return runAction(shipmentRemovePhotoSchema, input, { perm: "shipments.update" }, async (data, ctx) => {
    const { data: currentRow } = await ctx.supabase
      .from("shipments")
      .select("id, receipt_photo_paths")
      .eq("id", data.id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    const current = currentRow as { id: string; receipt_photo_paths: string[] | null } | null;
    if (!current) throw new ActionError("Shipment not found");
    const paths = current.receipt_photo_paths ?? [];
    if (!paths.includes(data.path)) throw new ActionError("That photo is no longer on this shipment");
    const updated = unwrap(
      await ctx.supabase
        .from("shipments")
        .update({ receipt_photo_paths: paths.filter((p) => p !== data.path) })
        .eq("id", data.id)
        .eq("business_id", ctx.business.id)
        .select("id"),
    ) as { id: string }[] | null;
    if (!updated?.length) throw new ActionError("You don't have permission to change this shipment");
    // The file is removed after the row no longer points at it; a failure here only leaves an unused file behind.
    if (isReceiptPathFor(ctx.business.id, data.path)) {
      await ctx.supabase.storage.from(BUCKETS.shipmentReceipts).remove([data.path]);
    }
    revalidatePath(`/app/shipments/${data.id}`);
  });
}
