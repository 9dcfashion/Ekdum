"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { financialYear } from "@/lib/dates";
import { COMMON_COURIERS } from "@/lib/settings/nav";
import { creditNotePrefixFor, sampleNumber } from "@/lib/settings/series";
import { brandingSchema, businessDetailsSchema, paymentDetailsSchema } from "@/lib/validation/onboarding";
import {
  activeToggleSchema,
  courierSchema,
  deviceRenameSchema,
  idSchema,
  invoicePrefsSchema,
  notificationPrefsSchema,
  outletCreateSchema,
  outletUpdateSchema,
  seriesCreateSchema,
  seriesNumberSchema,
  seriesPrefixSchema,
} from "@/lib/validation/settings";

const SETTINGS = { perm: "settings.manage" } as const;

/** Business details show up in the shell, on bills and in the POS, so refresh everything. */
function refreshAll() {
  revalidatePath("/app", "layout");
}

// ── Business profile, branding, payments, invoice, notifications ────────────

const businessProfileInput = z.object({ profile: businessDetailsSchema, confirm_scheme_change: z.boolean() });

export async function saveBusinessProfileAction(input: unknown) {
  return runAction(businessProfileInput, input, SETTINGS, async ({ profile, confirm_scheme_change }, ctx) => {
    if (profile.gst_scheme !== ctx.business.gst_scheme && !confirm_scheme_change) {
      throw new ActionError("Please confirm the change of GST registration type");
    }
    if (profile.gst_scheme === "unregistered") {
      const { data } = await ctx.supabase.from("outlets").select("name").eq("business_id", ctx.business.id).not("gstin", "is", null);
      const names = ((data ?? []) as Array<{ name: string }>).map((o) => o.name);
      if (names.length > 0) {
        throw new ActionError(
          `An unregistered business cannot have outlet GSTINs. Remove the GSTIN from ${names.join(", ")} under Outlets first.`,
        );
      }
    }
    // Only future bills are affected: posted bills keep the seller details they were issued with.
    unwrap(await ctx.supabase.from("businesses").update(profile).eq("id", ctx.business.id));
    refreshAll();
  });
}

export async function saveBrandingSettingsAction(input: unknown) {
  return runAction(brandingSchema, input, SETTINGS, async (data, ctx) => {
    if (data.logo_path && !data.logo_path.startsWith(`${ctx.business.id}/`)) {
      throw new ActionError("That logo does not belong to this business");
    }
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    refreshAll();
  });
}

export async function savePaymentSettingsAction(input: unknown) {
  return runAction(paymentDetailsSchema, input, SETTINGS, async (data, ctx) => {
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    refreshAll();
  });
}

export async function saveInvoicePrefsAction(input: unknown) {
  return runAction(invoicePrefsSchema, input, SETTINGS, async (data, ctx) => {
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    refreshAll();
  });
}

export async function saveNotificationPrefsAction(input: unknown) {
  return runAction(notificationPrefsSchema, input, SETTINGS, async (data, ctx) => {
    unwrap(await ctx.supabase.from("businesses").update(data).eq("id", ctx.business.id));
    refreshAll();
  });
}

// ── Outlets ─────────────────────────────────────────────────────────────────

async function usedPrefixes(ctx: AppContext): Promise<Set<string>> {
  const { data, error } = await ctx.supabase.from("invoice_series").select("prefix").eq("business_id", ctx.business.id);
  if (error) throw new ActionError(describeDbError(error));
  return new Set(((data ?? []) as Array<{ prefix: string }>).map((s) => s.prefix));
}

function prefixTaken(prefix: string): ActionError {
  const message = `The prefix ${prefix} is already used by another series. Choose a different one.`;
  return new ActionError(message, { prefix: [message], invoice_prefix: [message] });
}

/** Adds an outlet together with its invoice and credit-note series for the current financial year. */
export async function addOutletAction(input: unknown) {
  return runAction(outletCreateSchema, input, SETTINGS, async ({ outlet, invoice_prefix }, ctx) => {
    if (ctx.business.gst_scheme === "unregistered" && outlet.gstin) {
      throw new ActionError("An unregistered business cannot have an outlet GSTIN");
    }
    const used = await usedPrefixes(ctx);
    if (used.has(invoice_prefix)) throw prefixTaken(invoice_prefix);
    const creditPrefix = creditNotePrefixFor(invoice_prefix, used);
    if (!creditPrefix) throw new ActionError("Could not find a free credit-note prefix. Try a different invoice prefix.");

    // The id is made here and nothing is read back: a manager who is limited to
    // some outlets may add one without being able to see it afterwards.
    const outletId = randomUUID();
    unwrap(await ctx.supabase.from("outlets").insert({ id: outletId, ...outlet, business_id: ctx.business.id, created_by: ctx.user.id }));

    const fy = financialYear();
    const series = (document_type: "invoice" | "credit_note", prefix: string) => ({
      business_id: ctx.business.id,
      outlet_id: outletId,
      document_type,
      prefix,
      financial_year: fy,
      created_by: ctx.user.id,
    });
    const { error } = await ctx.supabase
      .from("invoice_series")
      .insert([series("invoice", invoice_prefix), series("credit_note", creditPrefix)]);
    refreshAll();
    if (error) {
      throw new ActionError(
        `The outlet was added, but its bill numbers could not be set up: ${describeDbError(error)} Add a series for it under Invoice series before billing there.`,
      );
    }

    const canSeeIt = ctx.memberships.find((m) => m.memberId === ctx.memberId)?.allOutlets ?? false;
    return { id: outletId, invoicePrefix: invoice_prefix, creditNotePrefix: creditPrefix, canSeeIt };
  });
}

export async function updateOutletAction(input: unknown) {
  return runAction(outletUpdateSchema, input, SETTINGS, async ({ id, outlet, is_active }, ctx) => {
    if (ctx.business.gst_scheme === "unregistered" && outlet.gstin) {
      throw new ActionError("An unregistered business cannot have an outlet GSTIN");
    }
    const { data: existing } = await ctx.supabase
      .from("outlets")
      .select("id, is_active")
      .eq("id", id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!existing) throw new ActionError("This outlet was not found");

    if (existing.is_active && !is_active) {
      const { count } = await ctx.supabase
        .from("outlets")
        .select("id", { count: "exact", head: true })
        .eq("business_id", ctx.business.id)
        .eq("is_active", true)
        .neq("id", id);
      if (!count) throw new ActionError("This is your only active outlet. A business needs at least one active outlet.");
    }

    unwrap(await ctx.supabase.from("outlets").update({ ...outlet, is_active }).eq("id", id).eq("business_id", ctx.business.id));
    refreshAll();
  });
}

// ── Invoice series ──────────────────────────────────────────────────────────

interface SeriesRow {
  id: string;
  outlet_id: string;
  pos_device_id: string | null;
  document_type: "invoice" | "credit_note";
  prefix: string;
  financial_year: string;
  next_number: number;
  is_active: boolean;
}

async function loadServerSeries(ctx: AppContext, id: string): Promise<SeriesRow> {
  const { data } = await ctx.supabase
    .from("invoice_series")
    .select("id, outlet_id, pos_device_id, document_type, prefix, financial_year, next_number, is_active")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!data) throw new ActionError("This series was not found");
  const series = { ...(data as SeriesRow), next_number: Number((data as SeriesRow).next_number) };
  if (series.pos_device_id) {
    throw new ActionError("This series belongs to a POS device and keeps its own count. Manage it under POS devices.");
  }
  return series;
}

const TOO_LONG = "With this prefix the bill number would be longer than 16 characters, which GST rules do not allow.";

export async function addSeriesAction(input: unknown) {
  return runAction(seriesCreateSchema, input, SETTINGS, async (data, ctx) => {
    const { data: outlet } = await ctx.supabase
      .from("outlets")
      .select("id")
      .eq("id", data.outlet_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!outlet) throw new ActionError("Select an outlet");

    const fy = financialYear();
    if (!sampleNumber(data.prefix, fy, data.start_number)) throw new ActionError(TOO_LONG, { prefix: [TOO_LONG] });
    if ((await usedPrefixes(ctx)).has(data.prefix)) throw prefixTaken(data.prefix);

    // Only one active server series per outlet, document type and financial year.
    const { data: current } = await ctx.supabase
      .from("invoice_series")
      .select("id, prefix")
      .eq("business_id", ctx.business.id)
      .eq("outlet_id", data.outlet_id)
      .eq("document_type", data.document_type)
      .eq("financial_year", fy)
      .is("pos_device_id", null)
      .eq("is_active", true)
      .maybeSingle();
    if (current && !data.replace_current) {
      throw new ActionError(
        `This outlet already has an active series (${current.prefix}). Tick “Switch off the current series” to replace it.`,
      );
    }
    if (current) unwrap(await ctx.supabase.from("invoice_series").update({ is_active: false }).eq("id", current.id));

    const { error } = await ctx.supabase.from("invoice_series").insert({
      business_id: ctx.business.id,
      outlet_id: data.outlet_id,
      document_type: data.document_type,
      prefix: data.prefix,
      financial_year: fy,
      next_number: data.start_number,
      created_by: ctx.user.id,
    });
    if (error) {
      // Put the old series back so the outlet can keep billing.
      if (current) await ctx.supabase.from("invoice_series").update({ is_active: true }).eq("id", current.id);
      throw new ActionError(describeDbError(error));
    }
    revalidatePath("/app/settings/series");
  });
}

/** The prefix can change only while the series has not issued any number. */
export async function changeSeriesPrefixAction(input: unknown) {
  return runAction(seriesPrefixSchema, input, SETTINGS, async ({ id, prefix }, ctx) => {
    const series = await loadServerSeries(ctx, id);
    if (series.prefix === prefix) return;
    if (series.next_number > 1) {
      throw new ActionError("This series has already issued numbers, so its prefix cannot change. Add a new series instead.");
    }
    if (!sampleNumber(prefix, series.financial_year, 1)) throw new ActionError(TOO_LONG, { prefix: [TOO_LONG] });
    if ((await usedPrefixes(ctx)).has(prefix)) throw prefixTaken(prefix);
    unwrap(await ctx.supabase.from("invoice_series").update({ prefix }).eq("id", id).eq("business_id", ctx.business.id));
    revalidatePath("/app/settings/series");
  });
}

/** The next number can only move forward: issued numbers are never handed out again. */
export async function raiseSeriesNumberAction(input: unknown) {
  return runAction(seriesNumberSchema, input, SETTINGS, async ({ id, next_number }, ctx) => {
    const series = await loadServerSeries(ctx, id);
    if (next_number <= series.next_number) {
      const message = `The next number can only be raised. It is ${series.next_number} now.`;
      throw new ActionError(message, { next_number: [message] });
    }
    if (!sampleNumber(series.prefix, series.financial_year, next_number)) {
      const message = "That number is too large: the bill number would be longer than 16 characters.";
      throw new ActionError(message, { next_number: [message] });
    }
    // If a bill was posted in between, the database refuses to move the number backwards.
    unwrap(await ctx.supabase.from("invoice_series").update({ next_number }).eq("id", id).eq("business_id", ctx.business.id));
    revalidatePath("/app/settings/series");
  });
}

export async function setSeriesActiveAction(input: unknown) {
  return runAction(activeToggleSchema, input, SETTINGS, async ({ id, is_active }, ctx) => {
    await loadServerSeries(ctx, id);
    unwrap(await ctx.supabase.from("invoice_series").update({ is_active }).eq("id", id).eq("business_id", ctx.business.id));
    revalidatePath("/app/settings/series");
  });
}

// ── POS devices ─────────────────────────────────────────────────────────────

export async function renameDeviceAction(input: unknown) {
  return runAction(deviceRenameSchema, input, SETTINGS, async ({ id, name }, ctx) => {
    const rows = unwrap(
      await ctx.supabase.from("pos_devices").update({ name }).eq("id", id).eq("business_id", ctx.business.id).select("id"),
    );
    if (!rows || rows.length === 0) throw new ActionError("This device was not found");
    revalidatePath("/app/settings/devices");
  });
}

export async function setDeviceActiveAction(input: unknown) {
  return runAction(activeToggleSchema, input, SETTINGS, async ({ id, is_active }, ctx) => {
    const rows = unwrap(
      await ctx.supabase.from("pos_devices").update({ is_active }).eq("id", id).eq("business_id", ctx.business.id).select("id"),
    );
    if (!rows || rows.length === 0) throw new ActionError("This device was not found");
    revalidatePath("/app/settings/devices");
  });
}

// ── Courier partners ────────────────────────────────────────────────────────

export async function saveCourierAction(input: unknown) {
  return runAction(courierSchema, input, SETTINGS, async ({ id, ...courier }, ctx) => {
    if (id) {
      const rows = unwrap(
        await ctx.supabase.from("courier_partners").update(courier).eq("id", id).eq("business_id", ctx.business.id).select("id"),
      );
      if (!rows || rows.length === 0) throw new ActionError("This courier was not found");
    } else {
      unwrap(await ctx.supabase.from("courier_partners").insert({ ...courier, business_id: ctx.business.id, created_by: ctx.user.id }));
    }
    revalidatePath("/app/settings/couriers");
  });
}

export async function deleteCourierAction(input: unknown) {
  return runAction(idSchema, input, SETTINGS, async ({ id }, ctx) => {
    const { error } = await ctx.supabase.from("courier_partners").delete().eq("id", id).eq("business_id", ctx.business.id);
    if (error) {
      if (error.code === "23503") {
        throw new ActionError("This courier has shipments, so it cannot be deleted. Switch it off instead.");
      }
      throw new ActionError(describeDbError(error));
    }
    revalidatePath("/app/settings/couriers");
  });
}

/** Adds well-known courier names that are not in the list yet. Names only: tracking links are never guessed. */
export async function addCommonCouriersAction() {
  return runAction(z.undefined(), undefined, SETTINGS, async (_input, ctx) => {
    const { data, error } = await ctx.supabase.from("courier_partners").select("name").eq("business_id", ctx.business.id);
    if (error) throw new ActionError(describeDbError(error));
    const existing = new Set(((data ?? []) as Array<{ name: string }>).map((c) => c.name.trim().toLowerCase()));
    const missing = COMMON_COURIERS.filter((name) => !existing.has(name.toLowerCase()));
    if (missing.length > 0) {
      unwrap(
        await ctx.supabase.from("courier_partners").insert(
          missing.map((name) => ({
            business_id: ctx.business.id,
            name,
            tracking_url_template: null,
            is_active: true,
            created_by: ctx.user.id,
          })),
        ),
      );
    }
    revalidatePath("/app/settings/couriers");
    return { added: missing.length };
  });
}
