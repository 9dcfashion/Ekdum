"use client";

import { useState } from "react";
import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { PackageCheck, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addQuickItemPackAction } from "@/lib/quick-items/actions";
import { useAction } from "@/lib/use-action";
import { quickProductSchema, type QuickProductInput } from "@/lib/validation/onboarding";
import { finishOnboardingAction, quickAddProductAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, applyFieldErrors } from "./shared";

export function ProductsStep({ data }: { data: WizardData }) {
  const router = useRouter();
  const add = useAction();
  const finish = useAction();
  const [products, setProducts] = useState(data.products);
  const pack = useAction();
  const [packAdded, setPackAdded] = useState(0);
  const [destination, setDestination] = useState("/app");
  const chargesGst = data.business!.gst_scheme === "regular";

  const defaults: QuickProductInput = {
    name: "",
    sale_price: "",
    price_includes_tax: true,
    gst_rate: chargesGst ? "18" : "0",
    unit_code: "PCS",
    hsn_code: "",
    opening_stock: "",
  };
  const form = useForm<QuickProductInput>({ resolver: zodResolver(quickProductSchema), defaultValues: defaults });
  const { errors } = form.formState;

  function done(to: string) {
    setDestination(to);
    finish.run(() => finishOnboardingAction(), {
      success: "Your shop is ready. Ekdum sorted!",
      onSuccess: () => {
        router.replace(to);
        router.refresh();
      },
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            <Sparkles className="size-4 text-primary" aria-hidden /> Selling jewellery?
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {packAdded
              ? `Done. ${packAdded} quick buttons (Necklace, Finger Ring, Bracelet, Earrings…) are ready on the billing screen. You can change them later in Settings.`
              : "Add quick buttons for Necklace, Finger Ring, Bracelet, Earrings and more, at GST 3% and HSN 7117. Staff then type only the rate."}
          </p>
        </div>
        {!packAdded ? (
          <SubmitButton
            type="button"
            variant="outline"
            pending={pack.pending}
            onClick={() =>
              pack.run(() => addQuickItemPackAction({ pack: "jewellery" }), {
                success: (r) => (r.added ? `Added ${r.added} quick items` : "Already added"),
                onSuccess: (r) => setPackAdded(r.added || 1),
              })
            }
          >
            Add jewellery buttons
          </SubmitButton>
        ) : null}
      </div>

      <form
        noValidate
        className="grid items-start gap-4 sm:grid-cols-6"
        onSubmit={form.handleSubmit((values) =>
          add.run(() => quickAddProductAction(values), {
            success: (p) => `Added ${p.name}`,
            onSuccess: (p) => {
              setProducts((list) => [...list, p]);
              form.reset({ ...defaults, gst_rate: values.gst_rate, unit_code: values.unit_code, price_includes_tax: values.price_includes_tax });
              form.setFocus("name");
            },
            onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
          }),
        )}
      >
        <Field label="Product name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-3">
          <Input id="name" autoFocus {...form.register("name")} />
        </Field>
        <Field label="Selling price" htmlFor="sale_price" required error={errors.sale_price?.message} className="sm:col-span-2">
          <MoneyInput id="sale_price" {...form.register("sale_price")} />
        </Field>
        <Field label="Unit" htmlFor="unit_code" error={errors.unit_code?.message}>
          <NativeSelect id="unit_code" {...form.register("unit_code")}>
            {data.units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {chargesGst ? (
          <>
            <Field label="GST rate" htmlFor="gst_rate" error={errors.gst_rate?.message} className="sm:col-span-2">
              <NativeSelect id="gst_rate" {...form.register("gst_rate")}>
                {data.gstRates.map((r) => (
                  <option key={r.id} value={String(r.rate)}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="HSN code" htmlFor="hsn_code" error={errors.hsn_code?.message} className="sm:col-span-2" hint="4, 6 or 8 digits">
              <Input id="hsn_code" inputMode="numeric" maxLength={8} className="tabular" {...form.register("hsn_code")} />
            </Field>
          </>
        ) : null}
        <Field label="Opening stock" htmlFor="opening_stock" error={errors.opening_stock?.message} className="sm:col-span-2" hint="Optional">
          <Input id="opening_stock" inputMode="decimal" className="tabular" {...form.register("opening_stock")} />
        </Field>
        {chargesGst ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-4">
            <input type="checkbox" className="accent-[var(--primary)]" {...form.register("price_includes_tax")} />
            Selling price already includes GST (MRP style)
          </label>
        ) : null}
        <div className="sm:col-span-2 sm:text-right">
          <SubmitButton pending={add.pending} variant="outline">
            Add product
          </SubmitButton>
        </div>
      </form>

      {products.length > 0 ? (
        <div className="mt-5 rounded-xl border bg-muted/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <PackageCheck className="size-4 text-emerald-600" aria-hidden /> {products.length} product
            {products.length === 1 ? "" : "s"} added
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{products.map((p) => p.name).join(" · ")}</p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Add a few products now, import your full list from a CSV file after setup, or skip and do it later.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          done("/app");
        }}
      >
        <StepFooter
          step={7}
          pending={finish.pending && destination === "/app"}
          submitLabel={products.length ? "Finish setup" : "Skip and finish"}
          secondary={
            <Button type="button" variant="outline" size="lg" disabled={finish.pending} onClick={() => done("/app/products/import")}>
              Finish and import CSV
            </Button>
          }
        />
      </form>
    </div>
  );
}
