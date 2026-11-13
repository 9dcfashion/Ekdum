import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ExternalLink, FileText, MapPin, Phone } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EditDetails } from "@/components/shipments/edit-details";
import { ReceiptPhotos, type ReceiptPhoto } from "@/components/shipments/receipt-photos";
import { StatusActions } from "@/components/shipments/status-actions";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate, formatDateTime, istDateString } from "@/lib/dates";
import { formatMobile, stateName } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import {
  buildTrackingUrl,
  daysOpen,
  daysOpenLabel,
  isOpenStatus,
  isStuck,
  MAX_RECEIPT_PHOTOS,
  shipmentStatusLabel,
} from "@/lib/shipments";
import { BUCKETS } from "@/lib/storage";
import type { Shipment, ShipmentEvent } from "@/lib/types/db";

export const metadata = { title: "Shipment" };

type CourierRow = { id: string; name: string; tracking_url_template: string | null; is_active: boolean };
type DetailRow = Shipment & {
  courier: CourierRow | null;
  invoice: { id: string; invoice_number: string } | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("shipments.view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data: shipmentRow } = await ctx.supabase
    .from("shipments")
    .select("*, courier:courier_partners(id, name, tracking_url_template, is_active), invoice:sales_invoices(id, invoice_number)")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  const shipment = shipmentRow as unknown as DetailRow | null;
  if (!shipment) notFound();

  const canUpdate = ctx.can("shipments.update");
  const canSeeSales = ctx.can(["sales.view_all", "sales.view_own"]);
  const photoPaths = shipment.receipt_photo_paths ?? [];

  const [eventsResult, signedResult, couriersResult] = await Promise.all([
    ctx.supabase
      .from("shipment_events")
      .select("id, shipment_id, status, note, created_by, created_at")
      .eq("shipment_id", shipment.id)
      .eq("business_id", ctx.business.id)
      .order("created_at", { ascending: false }),
    photoPaths.length > 0
      ? ctx.supabase.storage.from(BUCKETS.shipmentReceipts).createSignedUrls(photoPaths, 3600)
      : Promise.resolve({ data: [] }),
    canUpdate
      ? ctx.supabase
          .from("courier_partners")
          .select("id, name, is_active")
          .eq("business_id", ctx.business.id)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const events = (eventsResult.data ?? []) as ShipmentEvent[];

  // created_by points at auth.users, so names are fetched separately.
  const actorIds = [...new Set(events.map((e) => e.created_by).filter((v): v is string => !!v))];
  const { data: profileRows } = actorIds.length
    ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const names = new Map(
    ((profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [
      p.id,
      p.full_name?.trim() || p.email || "Staff",
    ]),
  );

  const signed = (signedResult.data ?? []) as Array<{ path: string | null; signedUrl: string | null }>;
  const photos: ReceiptPhoto[] = photoPaths.map((path, index) => ({
    path,
    url: signed.find((s) => s.path === path)?.signedUrl ?? signed[index]?.signedUrl ?? null,
  }));

  const couriers = (couriersResult.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  if (shipment.courier && !couriers.some((c) => c.id === shipment.courier!.id)) {
    couriers.push({ id: shipment.courier.id, name: shipment.courier.name, is_active: shipment.courier.is_active });
  }

  const today = istDateString();
  const open = isOpenStatus(shipment.status);
  const days = daysOpen(shipment.shipped_on, today);
  const stuck = isStuck(shipment.status, shipment.shipped_on, ctx.business.stuck_shipment_days, today);
  const trackingUrl = buildTrackingUrl(shipment.courier?.tracking_url_template, shipment.tracking_number);
  const outletName = ctx.outlets.find((o) => o.id === shipment.outlet_id)?.name;
  const addressLines = [
    shipment.address_line1,
    shipment.address_line2,
    [shipment.city, shipment.pincode].filter(Boolean).join(" - "),
    shipment.state_code ? stateName(shipment.state_code) : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={shipment.recipient_name}
        description={
          <span className="tabular">
            Shipped {formatDate(shipment.shipped_on)}
            {open ? ` · ${days === 0 ? "today" : `${daysOpenLabel(days)} ago`}` : ""}
            {outletName ? ` · ${outletName}` : ""}
          </span>
        }
        backHref="/app/shipments"
        actions={
          canUpdate ? (
            <EditDetails
              shipmentId={shipment.id}
              couriers={couriers}
              values={{
                courier_partner_id: shipment.courier_partner_id,
                tracking_number: shipment.tracking_number,
                notes: shipment.notes,
              }}
            />
          ) : undefined
        }
      />

      <div className="grid gap-4">
        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-status">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="sec-status" className="text-sm font-medium">
              Status
            </h2>
            <StatusBadge status={shipment.status} />
            {stuck ? <StatusBadge tone="amber" label={`Stuck: open ${daysOpenLabel(days)}`} /> : null}
            <span className="tabular ml-auto text-xs text-muted-foreground">Since {formatDateTime(shipment.status_changed_at)}</span>
          </div>
          {canUpdate ? (
            <StatusActions key={shipment.status} shipmentId={shipment.id} status={shipment.status} />
          ) : (
            <p className="text-sm text-muted-foreground">Your role can view shipments but cannot change their status.</p>
          )}
        </section>

        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-courier">
          <h2 id="sec-courier" className="mb-1 text-sm font-medium">
            Courier
          </h2>
          <dl className="divide-y">
            <Row label="Courier partner">{shipment.courier?.name ?? <span className="text-muted-foreground">Not set</span>}</Row>
            <Row label="Tracking number">
              {shipment.tracking_number ? (
                <span className="tabular font-medium break-all">{shipment.tracking_number}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </Row>
          </dl>
          {trackingUrl ? (
            <Button asChild className="mt-3 h-12 w-full text-base md:h-9 md:w-auto md:text-sm">
              <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden /> Track on {shipment.courier?.name ?? "courier site"}
              </a>
            </Button>
          ) : shipment.tracking_number && shipment.courier && !shipment.courier.tracking_url_template ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No tracking link is set up for {shipment.courier.name}.
              {ctx.can("settings.manage") ? (
                <>
                  {" "}
                  <Link href="/app/settings/couriers" className="text-primary underline-offset-4 hover:underline">
                    Add one in Settings
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-recipient">
          <h2 id="sec-recipient" className="mb-2 text-sm font-medium">
            Recipient
          </h2>
          <p className="font-medium">{shipment.recipient_name}</p>
          {addressLines.length > 0 ? (
            <p className="mt-1 flex gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {addressLines.map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No address saved.</p>
          )}
          {shipment.recipient_phone ? (
            <Button variant="outline" asChild className="mt-3 h-12 w-full text-base md:h-9 md:w-auto md:text-sm">
              <a href={`tel:${shipment.recipient_phone}`}>
                <Phone aria-hidden /> Call <span className="tabular">{formatMobile(shipment.recipient_phone)}</span>
              </a>
            </Button>
          ) : null}
        </section>

        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-parcel">
          <h2 id="sec-parcel" className="mb-1 text-sm font-medium">
            Parcel
          </h2>
          <dl className="divide-y">
            <Row label="Packages">
              <span className="tabular">{shipment.package_count}</span>
            </Row>
            {shipment.weight_grams ? (
              <Row label="Weight">
                <span className="tabular">
                  {shipment.weight_grams >= 1000
                    ? `${(shipment.weight_grams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`
                    : `${shipment.weight_grams} g`}
                </span>
              </Row>
            ) : null}
            {shipment.declared_value_paise !== null ? (
              <Row label="Declared value">
                <span className="tabular">{formatINR(shipment.declared_value_paise)}</span>
              </Row>
            ) : null}
            <Row label="Bill">
              {shipment.invoice ? (
                canSeeSales ? (
                  <Link
                    href={`/app/sales/${shipment.invoice.id}`}
                    className="tabular inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    <FileText className="size-3.5" aria-hidden /> {shipment.invoice.invoice_number}
                  </Link>
                ) : (
                  <span className="tabular">{shipment.invoice.invoice_number}</span>
                )
              ) : shipment.invoice_id ? (
                <span className="text-muted-foreground">Linked to a bill you cannot open</span>
              ) : (
                <span className="text-muted-foreground">Standalone shipment</span>
              )}
            </Row>
          </dl>
          {shipment.notes ? (
            <div className="mt-2 border-t pt-2">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm break-words whitespace-pre-wrap">{shipment.notes}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-photos">
          <h2 id="sec-photos" className="mb-3 text-sm font-medium">
            Receipt photos
          </h2>
          <ReceiptPhotos
            shipmentId={shipment.id}
            businessId={ctx.business.id}
            photos={photos}
            canEdit={canUpdate}
            maxPhotos={MAX_RECEIPT_PHOTOS}
          />
        </section>

        <section className="rounded-xl border p-3 sm:p-4" aria-labelledby="sec-timeline">
          <h2 id="sec-timeline" className="mb-3 text-sm font-medium">
            Timeline
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No updates yet.</p>
          ) : (
            <ol className="relative ml-1.5 grid gap-4 border-l pl-4">
              {events.map((event, index) => (
                <li key={event.id} className="relative">
                  <span
                    className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background ${index === 0 ? "bg-primary" : "bg-muted-foreground/40"}`}
                    aria-hidden
                  />
                  <p className="text-sm font-medium">{shipmentStatusLabel(event.status)}</p>
                  {event.note ? <p className="text-sm break-words whitespace-pre-wrap">{event.note}</p> : null}
                  <p className="tabular text-xs text-muted-foreground">
                    {formatDateTime(event.created_at)}
                    {event.created_by ? ` · ${names.get(event.created_by) ?? "Staff"}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
