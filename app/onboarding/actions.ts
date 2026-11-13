"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, describeDbError, fail, ok, runAction, unwrap, type ActionResult } from "@/lib/actions";
import { BUSINESS_COOKIE, OUTLET_COOKIE, loadContext, type AppContext } from "@/lib/auth/context";
import { financialYear } from "@/lib/dates";
import { createInvitation } from "@/lib/staff/invites";
import { emailRequired, optionalText, uuid } from "@/lib/validation/common";
import {
  brandingSchema,
  businessDetailsSchema,
  invoiceSettingsSchema,
  outletSchema,
  paymentDetailsSchema,
  quickProductSchema,
  TOTAL_STEPS,
} from "@/lib/validation/onboarding";

const ONBOARDING = { perm: "settings.manage", allowDuringOnboarding: true } as const;

/** Move the saved wizard position forward (never backwards) so the user can resume later. */
async function advance(ctx: AppContext, completedStep: number) {
  const next = Math.min(TOTAL_STEPS, Math.max(ctx.business.onboarding_step, completedStep + 1));
  if (next !== ctx.business.onboarding_step) {
    unwrap(await ctx.supabase.from("businesses").update({ onboarding_step: next }).eq("id", ctx.business.id));
  }
  revalidatePath("/onboarding");
}

/** Step 1. Creates the business on first save, updates it afterwards. */
export async function saveBusinessDetailsAction(input: unknown, createNew: boolean): Promise<ActionResult> {
  const ctx = await loadContext();
  if (!ctx) return fail("Your session has expired. Please sign in again.");
  const parsed = businessDetailsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "_form"] ??= []).push(issue.message);
    return fail(parsed.error.issues[0]?.message ?? "Please check the form", fieldErrors);
  }
  const data = parsed.data;

  const editingExisting = !createNew && ctx.business && !ctx.business.onboarding_completed_at;
  if (editingExisting) {
    if (!ctx.can("settings.manage")) return fail("You don't have permission to do this");
    const { error } = await ctx.supabase
      .from("businesses")
      .update({ ...data, onboarding_step: Math.max(ctx.business!.onboarding_step, 2) })
      .eq("id", ctx.business!.id);
    if (error) return fail(describeDbError(error));
  } else {
    const { data: businessId, error } = await ctx.supabase.rpc("create_business", { p: data });
    if (error) return fail(describeDbError(error));
    const cookieStore = await cookies();
    cookieStore.set(BUSINESS_COOKIE, businessId as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    cookieStore.delete(OUTLET_COOKIE);
  }
  revalidatePath("/onboarding");
  return ok();
}

/** Step 2. */
export async function saveBrandingAction(input: unknown) {
  return runAction(brandingSchema, input, ONBOARDING, async (data, ctx) => {
    if (data.logo_path && !data.logo_path.startsWith(`${ctx.business.id}/`)) {
      throw new ActionError("That logo does not belong to this business");
    }
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    await advance(ctx, 2);
  });
}

/** Step 3. */
export async function savePaymentDetailsAction(input: unknown) {
  return runAction(paymentDetailsSchema, input, ONBOARDING, async (data, ctx) => {
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    await advance(ctx, 3);
  });
}

/** Step 4. Creates the first outlet, or updates it when the user comes back to this step. */
export async function saveFirstOutletAction(input: unknown) {
  return runAction(outletSchema, input, ONBOARDING, async (data, ctx) => {
    if (ctx.business.gst_scheme === "unregistered" && data.gstin) {
      throw new ActionError("An unregistered business cannot have an outlet GSTIN");
    }
    const existing = ctx.outlets[0];
    if (existing) {
      unwrap(await ctx.supabase.from("outlets").update(data).eq("id", existing.id));
    } else {
      unwrap(
        await ctx.supabase
          .from("outlets")
          .insert({ ...data, business_id: ctx.business.id, created_by: ctx.user.id })
          .select("id")
          .single(),
      );
    }
    await advance(ctx, 4);
  });
}

function creditNotePrefix(invoicePrefix: string): string {
  return invoicePrefix.length <= 2 ? `${invoicePrefix}CN` : `C${invoicePrefix}`.slice(0, 4);
}

/** Step 5. Number series for the first outlet + print and round-off preferences. */
export async function saveInvoiceSettingsAction(input: unknown) {
  return runAction(invoiceSettingsSchema, input, ONBOARDING, async (data, ctx) => {
    const outlet = ctx.outlets[0];
    if (!outlet) throw new ActionError("Add your outlet first");
    const fy = financialYear();

    const { data: seriesRows } = await ctx.supabase
      .from("invoice_series")
      .select("id, document_type, prefix, next_number")
      .eq("outlet_id", outlet.id)
      .is("pos_device_id", null)
      .eq("financial_year", fy);
    const invoiceSeries = seriesRows?.find((s) => s.document_type === "invoice");
    const creditSeries = seriesRows?.find((s) => s.document_type === "credit_note");

    if (!invoiceSeries) {
      unwrap(
        await ctx.supabase.from("invoice_series").insert({
          business_id: ctx.business.id,
          outlet_id: outlet.id,
          document_type: "invoice",
          prefix: data.prefix,
          financial_year: fy,
          next_number: data.start_number,
          created_by: ctx.user.id,
        }),
      );
    } else if (Number(invoiceSeries.next_number) === 1 || invoiceSeries.prefix === data.prefix) {
      // Still unused (or only the starting number is changing upwards): safe to edit.
      unwrap(
        await ctx.supabase
          .from("invoice_series")
          .update({ prefix: data.prefix, next_number: Math.max(Number(invoiceSeries.next_number), data.start_number) })
          .eq("id", invoiceSeries.id),
      );
    } else {
      throw new ActionError("This series has already issued bills. Change series from Settings → Invoice series.");
    }

    if (!creditSeries) {
      unwrap(
        await ctx.supabase.from("invoice_series").insert({
          business_id: ctx.business.id,
          outlet_id: outlet.id,
          document_type: "credit_note",
          prefix: creditNotePrefix(data.prefix),
          financial_year: fy,
          created_by: ctx.user.id,
        }),
      );
    } else if (Number(creditSeries.next_number) === 1) {
      unwrap(await ctx.supabase.from("invoice_series").update({ prefix: creditNotePrefix(data.prefix) }).eq("id", creditSeries.id));
    }

    unwrap(
      await ctx.supabase
        .from("businesses")
        .update({
          default_print_format: data.default_print_format,
          round_off_enabled: data.round_off_enabled,
          invoice_terms: data.invoice_terms,
          invoice_footer: data.invoice_footer,
        })
        .eq("id", ctx.business.id),
    );
    await advance(ctx, 5);
  });
}

const inviteSchema = z.object({
  email: emailRequired,
  full_name: optionalText(100),
  role_id: uuid,
});

/** Step 6 (optional). */
export async function inviteStaffDuringOnboardingAction(input: unknown) {
  return runAction(inviteSchema, input, { perm: "staff.manage", allowDuringOnboarding: true }, async (data, ctx) => {
    if (data.email === ctx.user.email.toLowerCase()) throw new ActionError("That is your own email address");
    const result = await createInvitation(ctx, { ...data, all_outlets: true, outlet_ids: [] });
    revalidatePath("/onboarding");
    return { acceptUrl: result.acceptUrl, emailed: result.emailed, email: data.email };
  });
}

export async function skipStepAction(step: number) {
  return runAction(z.number().int().min(1).max(TOTAL_STEPS), step, ONBOARDING, async (completed, ctx) => {
    await advance(ctx, completed);
  });
}

/** Step 7 (optional). A quick way to get the first few products in. */
export async function quickAddProductAction(input: unknown) {
  return runAction(
    quickProductSchema,
    input,
    { perm: "products.manage", allowDuringOnboarding: true },
    async (data, ctx) => {
      const product = unwrap(
        await ctx.supabase
          .from("products")
          .insert({
            business_id: ctx.business.id,
            name: data.name,
            sale_price_paise: data.sale_price,
            price_includes_tax: data.price_includes_tax,
            gst_rate: ctx.business.gst_scheme === "regular" ? data.gst_rate : 0,
            unit_code: data.unit_code,
            hsn_code: data.hsn_code,
            created_by: ctx.user.id,
          })
          .select("id, name")
          .single(),
      ) as { id: string; name: string };

      if (data.opening_stock && Number(data.opening_stock) > 0 && ctx.outlets[0]) {
        unwrap(
          await ctx.supabase.rpc("set_opening_stock", {
            p_product_id: product.id,
            p_outlet_id: ctx.outlets[0].id,
            p_quantity: data.opening_stock,
          }),
        );
      }
      revalidatePath("/onboarding");
      return product;
    },
  );
}

/** Marks onboarding complete. Refuses until the pieces billing needs are in place. */
export async function finishOnboardingAction() {
  return runAction(z.undefined(), undefined, ONBOARDING, async (_input, ctx) => {
    const outlet = ctx.outlets[0];
    if (!outlet) throw new ActionError("Add your outlet before finishing");
    const { count } = await ctx.supabase
      .from("invoice_series")
      .select("id", { count: "exact", head: true })
      .eq("outlet_id", outlet.id)
      .eq("document_type", "invoice");
    if (!count) throw new ActionError("Set your invoice number series before finishing");

    unwrap(
      await ctx.supabase
        .from("businesses")
        .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: TOTAL_STEPS })
        .eq("id", ctx.business.id),
    );
    revalidatePath("/", "layout");
  });
}
