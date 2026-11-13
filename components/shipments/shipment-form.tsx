"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FileText, Loader2, Search, X } from "lucide-react";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { isValidPincode } from "@/lib/gst";
import { SELECTABLE_STATES } from "@/lib/gst/states";
import { formatINR, paiseToRupees } from "@/lib/money";
import { MAX_RECEIPT_PHOTOS, splitAddress, type InvoiceMatch } from "@/lib/shipments";
import { useAction } from "@/lib/use-action";
import { shipmentCreateSchema, type ShipmentCreateInput } from "@/lib/validation/shipments";
import { createShipmentAction, searchInvoicesForShipmentAction } from "@/app/app/(shell)/shipments/actions";
import { PhotoPicker } from "./photo-picker";
import { usePhotoUploads } from "./use-photo-uploads";

/** Taller controls on phones (thumb friendly), compact on desktop. */
const TOUCH = "h-11 md:h-8";

type Prefill = Pick<
  ShipmentCreateInput,
  "recipient_name" | "recipient_phone" | "address_line1" | "address_line2" | "pincode" | "state_code" | "declared_value"
>;

function prefillFromInvoice(invoice: InvoiceMatch): Prefill {
  const address = splitAddress(invoice.customer_address);
  const pin = (invoice.customer_pincode ?? "").trim();
  const state = invoice.customer_state_code ?? "";
  return {
    recipient_name: invoice.customer_name ?? "",
    recipient_phone: invoice.customer_phone ?? "",
    address_line1: address.line1,
    address_line2: address.line2,
    pincode: isValidPincode(pin) ? pin : "",
    state_code: SELECTABLE_STATES.some((s) => s.code === state) ? state : "",
    declared_value: paiseToRupees(invoice.total_paise),
  };
}

function blankValues(today: string, invoice: InvoiceMatch | null): ShipmentCreateInput {
  return {
    invoice_id: invoice?.id ?? "",
    courier_partner_id: "",
    tracking_number: "",
    recipient_name: "",
    recipient_phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    pincode: "",
    state_code: "",
    shipped_on: today,
    package_count: "1",
    weight_grams: "",
    declared_value: "",
    notes: "",
    receipt_photo_paths: [],
    ...(invoice ? prefillFromInvoice(invoice) : {}),
  };
}

export function ShipmentForm({
  businessId,
  couriers,
  canManageCouriers,
  canPickInvoice,
  canView,
  initialInvoice,
  invoiceUnavailable,
  today,
}: {
  businessId: string;
  couriers: Array<{ id: string; name: string }>;
  canManageCouriers: boolean;
  canPickInvoice: boolean;
  canView: boolean;
  initialInvoice: InvoiceMatch | null;
  /** `?invoice=` pointed at a bill this user cannot open. */
  invoiceUnavailable: boolean;
  today: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const uploads = usePhotoUploads(businessId, MAX_RECEIPT_PHOTOS);
  const [invoice, setInvoice] = useState<InvoiceMatch | null>(initialInvoice);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const form = useForm<ShipmentCreateInput>({
    resolver: zodResolver(shipmentCreateSchema),
    defaultValues: blankValues(today, initialInvoice),
  });
  const { errors } = form.formState;

  function linkInvoice(next: InvoiceMatch) {
    setInvoice(next);
    // Fill from the bill, but keep anything already typed where the bill has nothing to offer.
    for (const [name, value] of Object.entries(prefillFromInvoice(next)) as Array<[keyof Prefill, string]>) {
      if (value) form.setValue(name, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    }
  }

  function submit() {
    if (uploads.busy) {
      setPhotoError("Photos are still uploading. Save again in a moment.");
      return;
    }
    if (uploads.failed > 0) {
      setPhotoError("A photo did not upload. Retry it or remove it, then save. Everything you typed is still here.");
      return;
    }
    setPhotoError(null);
    // Send what was typed (not the parsed values) so the server parses it exactly once.
    const raw = form.getValues();
    run(() => createShipmentAction({ ...raw, invoice_id: invoice?.id ?? "", receipt_photo_paths: uploads.paths }), {
      success: "Shipment saved",
      onSuccess: (result) => {
        if (result.canView) {
          router.push(`/app/shipments/${result.id}`);
          return;
        }
        uploads.reset();
        setInvoice(null);
        form.reset(blankValues(today, null));
        window.scrollTo({ top: 0 });
      },
      onError: (_error, fieldErrors) => {
        for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
          if (name in raw && messages[0]) form.setError(name as keyof ShipmentCreateInput, { message: messages[0] });
        }
      },
    });
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(submit, () => toast.error("Please check the highlighted fields"))}
      className="mx-auto grid max-w-2xl gap-4 pb-24 md:pb-0"
    >
      {invoiceUnavailable ? (
        <p className="rounded-xl border bg-muted/50 p-3 text-sm" role="status">
          We could not open that bill (it may belong to another outlet or you may not have access to sales), so this
          will be saved as a standalone shipment. Please fill in the recipient details.
        </p>
      ) : null}

      {invoice || canPickInvoice ? (
        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-bill">
          <h2 id="sec-bill" className="mb-3 text-sm font-medium">
            Bill <span className="font-normal text-muted-foreground">(optional)</span>
          </h2>
          {invoice ? (
            <div className="flex items-center gap-3">
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="tabular truncate font-medium">{invoice.invoice_number}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDate(invoice.invoice_date)} · {invoice.customer_name || "Walk-in customer"} ·{" "}
                  <span className="tabular">{formatINR(invoice.total_paise)}</span>
                </p>
              </div>
              <Button type="button" variant="outline" className={TOUCH} onClick={() => setInvoice(null)} disabled={pending}>
                <X aria-hidden /> Remove
              </Button>
            </div>
          ) : (
            <InvoicePicker onPick={linkInvoice} />
          )}
          {errors.invoice_id?.message ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {errors.invoice_id.message}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-courier">
        <h2 id="sec-courier" className="mb-3 text-sm font-medium">
          Courier
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Courier partner"
            htmlFor="courier_partner_id"
            error={errors.courier_partner_id?.message}
            hint={
              couriers.length === 0 ? (
                canManageCouriers ? (
                  <>
                    No courier partners yet.{" "}
                    <Link href="/app/settings/couriers" className="text-primary underline-offset-4 hover:underline">
                      Add them in Settings
                    </Link>{" "}
                    to get tracking links. You can still save without one.
                  </>
                ) : (
                  "No courier partners yet. Ask the owner to add them in Settings. You can still save without one."
                )
              ) : undefined
            }
          >
            <NativeSelect id="courier_partner_id" className={TOUCH} {...form.register("courier_partner_id")}>
              <option value="">{couriers.length === 0 ? "No courier partner" : "Select courier"}</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Tracking number" htmlFor="tracking_number" error={errors.tracking_number?.message} hint="AWB or docket number">
            <Input
              id="tracking_number"
              className={`${TOUCH} tabular`}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!errors.tracking_number}
              {...form.register("tracking_number")}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-recipient">
        <h2 id="sec-recipient" className="mb-3 text-sm font-medium">
          Recipient
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="recipient_name" required error={errors.recipient_name?.message}>
            <Input
              id="recipient_name"
              className={TOUCH}
              autoComplete="off"
              aria-invalid={!!errors.recipient_name}
              {...form.register("recipient_name")}
            />
          </Field>
          <Field label="Mobile number" htmlFor="recipient_phone" error={errors.recipient_phone?.message}>
            <Input
              id="recipient_phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className={`${TOUCH} tabular`}
              aria-invalid={!!errors.recipient_phone}
              {...form.register("recipient_phone")}
            />
          </Field>
          <Field label="Address line 1" htmlFor="address_line1" error={errors.address_line1?.message} className="sm:col-span-2">
            <Input id="address_line1" className={TOUCH} autoComplete="off" {...form.register("address_line1")} />
          </Field>
          <Field label="Address line 2" htmlFor="address_line2" error={errors.address_line2?.message} className="sm:col-span-2">
            <Input id="address_line2" className={TOUCH} autoComplete="off" {...form.register("address_line2")} />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city?.message}>
            <Input id="city" className={TOUCH} autoComplete="off" {...form.register("city")} />
          </Field>
          <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
            <Input
              id="pincode"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              className={`${TOUCH} tabular`}
              aria-invalid={!!errors.pincode}
              {...form.register("pincode")}
            />
          </Field>
          <Field label="State" htmlFor="state_code" error={errors.state_code?.message} className="sm:col-span-2">
            <StateSelect id="state_code" className={TOUCH} {...form.register("state_code")} />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-parcel">
        <h2 id="sec-parcel" className="mb-3 text-sm font-medium">
          Parcel
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Shipped on" htmlFor="shipped_on" required error={errors.shipped_on?.message}>
            <Input id="shipped_on" type="date" className={TOUCH} aria-invalid={!!errors.shipped_on} {...form.register("shipped_on")} />
          </Field>
          <Field label="Packages" htmlFor="package_count" required error={errors.package_count?.message}>
            <Input
              id="package_count"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              className={`${TOUCH} tabular`}
              aria-invalid={!!errors.package_count}
              {...form.register("package_count")}
            />
          </Field>
          <Field label="Weight (grams)" htmlFor="weight_grams" error={errors.weight_grams?.message} hint="Optional">
            <Input
              id="weight_grams"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              autoComplete="off"
              className={`${TOUCH} tabular`}
              aria-invalid={!!errors.weight_grams}
              {...form.register("weight_grams")}
            />
          </Field>
          <Field label="Declared value" htmlFor="declared_value" error={errors.declared_value?.message} hint="Optional">
            <MoneyInput
              id="declared_value"
              className={TOUCH}
              aria-invalid={!!errors.declared_value}
              {...form.register("declared_value")}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-photos">
        <h2 id="sec-photos" className="mb-1 text-sm font-medium">
          Receipt photos
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Photo of the courier receipt or the packed parcel. Up to {MAX_RECEIPT_PHOTOS} photos.
        </p>
        <PhotoPicker uploads={uploads} disabled={pending} />
        {photoError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {photoError}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border p-3 sm:p-4">
        <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </Field>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:z-auto md:flex md:justify-end md:gap-2 md:border-0 md:bg-transparent md:p-0">
        {canView ? (
          <Button variant="outline" size="lg" asChild className="hidden md:inline-flex">
            <Link href="/app/shipments">Cancel</Link>
          </Button>
        ) : null}
        <SubmitButton pending={pending} pendingText="Saving" size="lg" className="h-12 w-full text-base md:h-9 md:w-auto md:text-sm">
          {uploads.busy ? "Photos uploading" : "Save shipment"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Find a bill by its number. Lives inside the shipment form, so it never submits anything itself. */
function InvoicePicker({ onPick }: { onPick: (invoice: InvoiceMatch) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvoiceMatch[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  function search() {
    const q = query.trim();
    if (q.length < 2) {
      setMessage("Type at least 2 characters of the bill number");
      setResults(null);
      return;
    }
    startSearch(async () => {
      try {
        const result = await searchInvoicesForShipmentAction({ q });
        if (result.ok) {
          setResults(result.data);
          setMessage(result.data.length === 0 ? "No bill found with that number" : null);
        } else {
          setResults(null);
          setMessage(result.error);
        }
      } catch {
        setResults(null);
        setMessage("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // do not submit the shipment form
              search();
            }
          }}
          placeholder="Bill number, e.g. A/2627/00042"
          aria-label="Find a bill by number"
          autoCapitalize="characters"
          autoComplete="off"
          className={`${TOUCH} tabular`}
        />
        <Button type="button" variant="outline" className={TOUCH} onClick={search} disabled={searching}>
          {searching ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />} Find
        </Button>
      </div>
      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Linking a bill fills in the customer name, phone and address.</p>
      )}
      {results && results.length > 0 ? (
        <ul className="grid gap-1.5" aria-label="Matching bills">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="min-w-0">
                  <span className="tabular block truncate font-medium">{r.invoice_number}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDate(r.invoice_date)} · {r.customer_name || "Walk-in customer"}
                  </span>
                </span>
                <span className="tabular shrink-0">{formatINR(r.total_paise)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
