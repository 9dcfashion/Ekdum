"use client";

import { useEffect, useState } from "react";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { offlineScopeAction, registerPosDeviceAction } from "@/app/app/pos/actions";
import { financialYear, istDateString } from "@/lib/dates";
import { formatInvoiceNumber, normalisePrefix, validateSeriesPrefix } from "@/lib/gst/numbering";
import { generateDeviceKey, hashDeviceKeyHex } from "@/lib/offline/device";
import { getOfflineRepo, offlineStorageAvailable, requestPersistentStorage } from "@/lib/offline/db";
import { peekNumber } from "@/lib/offline/numbering";
import { isUnsynced } from "@/lib/offline/queue";
import { useDevices, useQueueRows } from "./use-offline";

type Scope = { state: "loading" } | { state: "ready"; businessId: string } | { state: "error"; message: string };

/**
 * "Register this device" in Settings → POS devices. The secret key is made in
 * this browser and stays in its IndexedDB; only its SHA-256 goes to the server.
 * A registered device numbers its own bills, so it can keep billing offline.
 */
export function RegisterThisDevice(props: { outlets: Array<{ id: string; name: string }>; usedPrefixes: string[] }) {
  const [scope, setScope] = useState<Scope>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    offlineScopeAction().then(
      (result) => !cancelled && setScope(result.ok ? { state: "ready", businessId: result.data.businessId } : { state: "error", message: result.error }),
      () => !cancelled && setScope({ state: "error", message: "Could not reach the server. Reload the page to register this device." }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <MonitorSmartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">This device</h3>
          <p className="text-sm text-muted-foreground">The browser you are using right now.</p>
        </div>
      </div>
      {scope.state === "loading" ? (
        <p className="text-sm text-muted-foreground">Checking this device…</p>
      ) : scope.state === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {scope.message}
        </p>
      ) : (
        <DevicePanel businessId={scope.businessId} {...props} />
      )}
    </div>
  );
}

function DevicePanel({
  businessId,
  outlets,
  usedPrefixes,
}: {
  businessId: string;
  outlets: Array<{ id: string; name: string }>;
  usedPrefixes: string[];
}) {
  const storage = offlineStorageAvailable();
  const devices = useDevices(businessId);
  const rows = useQueueRows(businessId);
  const [adding, setAdding] = useState(false);

  if (!storage) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        This browser does not allow saving data (for example a private window), so it cannot bill offline. It can still bill online.
      </p>
    );
  }
  if (devices === undefined) return <p className="text-sm text-muted-foreground">Checking this device…</p>;

  const free = outlets.filter((o) => !devices.some((d) => d.outletId === o.id));
  const today = istDateString();

  return (
    <div className="grid gap-4">
      {devices.map((device) => {
        const pending = rows.filter((r) => r.outletId === device.outletId && isUnsynced(r)).length;
        let next = "";
        try {
          next = peekNumber(device.prefix, device.counters ?? {}, today).number;
        } catch {
          next = "The series is full";
        }
        const outletName = outlets.find((o) => o.id === device.outletId)?.name ?? "an outlet you cannot open";
        return (
          <div key={device.outletId} className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
                  {device.name}
                </p>
                <p className="text-sm text-muted-foreground">Registered for {outletName}</p>
              </div>
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" disabled={pending > 0}>
                    Forget this device
                  </Button>
                }
                title={`Forget ${device.name} on this browser?`}
                description={
                  <>
                    This browser will stop numbering its own bills and will not be able to bill offline. The series {device.prefix} stays reserved for this
                    device and cannot be used again: registering later needs a new prefix. Also deactivate the device in the list below.
                  </>
                }
                confirmLabel="Forget this device"
                destructive
                onConfirm={async () => {
                  const repo = getOfflineRepo(businessId);
                  if (!repo) return false;
                  // Checked again at the last moment: a bill may have been made in another tab.
                  const waiting = (await repo.listQueue()).filter((r) => r.outletId === device.outletId && isUnsynced(r)).length;
                  if (waiting > 0) {
                    toast.error("There are bills on this device that have not synced yet. Sync them first.");
                    return false;
                  }
                  await repo.removeDevice(device.outletId);
                  toast.success("This browser is no longer a POS device");
                }}
              />
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Series prefix</dt>
                <dd className="tabular font-medium">{device.prefix}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Next bill number</dt>
                <dd className="tabular font-medium">{next}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Bills waiting to sync</dt>
                <dd className="tabular font-medium">{pending}</dd>
              </div>
            </dl>
            {device.revoked ? (
              <p className="text-sm text-destructive" role="alert">
                This device was deactivated on the server. It bills online with the outlet&apos;s own series and cannot bill offline. Forget it here, then register
                again if you still need it.
              </p>
            ) : null}
            {pending > 0 ? (
              <p className="text-sm text-amber-800">
                Open Billing while online to sync these bills. This device cannot be forgotten until they are synced: forgetting it would make them impossible to
                send.
              </p>
            ) : null}
          </div>
        );
      })}

      {devices.length === 0 || adding ? (
        free.length > 0 ? (
          <RegisterForm
            businessId={businessId}
            outlets={free}
            usedPrefixes={[...usedPrefixes, ...devices.map((d) => d.prefix)]}
            onDone={() => setAdding(false)}
            onCancel={devices.length > 0 ? () => setAdding(false) : undefined}
          />
        ) : (
          <p className="text-sm text-muted-foreground">You do not have access to an outlet this browser could be registered for.</p>
        )
      ) : free.length > 0 ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Register this browser for another outlet
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Bills made offline are kept in this browser until they sync. Do not clear this site&apos;s data, and do not use a private window, while bills are waiting.
      </p>
    </div>
  );
}

function RegisterForm({
  businessId,
  outlets,
  usedPrefixes,
  onDone,
  onCancel,
}: {
  businessId: string;
  outlets: Array<{ id: string; name: string }>;
  usedPrefixes: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const clean = normalisePrefix(prefix);
  const taken = usedPrefixes.map(normalisePrefix).includes(clean);
  const prefixError = !clean ? "Prefix is required" : (validateSeriesPrefix(clean) ?? (taken ? `The prefix ${clean} is already used by another series` : null));
  const nameError = name.trim() ? null : "Give this device a name";
  let sample = "";
  if (!prefixError) {
    try {
      sample = formatInvoiceNumber(clean, financialYear(), 1);
    } catch {
      sample = "";
    }
  }

  async function submit() {
    setTouched(true);
    if (saving || prefixError || nameError || !outletId) return;
    const repo = getOfflineRepo(businessId);
    if (!repo) return void toast.error("This browser does not allow saving data, so it cannot be registered");
    if (!globalThis.crypto?.subtle) return void toast.error("This page must be opened over https to register a device");
    setSaving(true);
    try {
      // The key is made here and never shown, logged or sent. The server only ever sees its hash.
      const key = generateDeviceKey();
      const keyHash = await hashDeviceKeyHex(key);
      const result = await registerPosDeviceAction({ outlet_id: outletId, name: name.trim(), prefix: clean, key_hash: keyHash });
      if (!result.ok) return void toast.error(result.error);
      await repo.saveDevice({
        outletId,
        deviceId: result.data.deviceId,
        key,
        name: result.data.name,
        prefix: result.data.prefix,
        counters: {},
        reservations: {},
        registeredAt: Date.now(),
      });
      const persistent = await requestPersistentStorage();
      toast.success(`This device is registered. Its bills will be numbered ${result.data.prefix}/…`, {
        description: persistent === false ? "Tip: install EkDum to the home screen so the browser never clears its saved bills." : undefined,
      });
      onDone();
    } catch {
      toast.error("Could not register this device. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        Register this browser as a billing counter. It gets its own bill number series, so it can keep billing when the internet is down.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Outlet" htmlFor="device-outlet" required>
          <NativeSelect id="device-outlet" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Device name" htmlFor="device-name" required error={touched ? nameError : null} hint="For example Counter 1">
          <Input id="device-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !!nameError} />
        </Field>
        <Field
          label="Series prefix"
          htmlFor="device-prefix"
          required
          error={touched || prefix ? prefixError : null}
          hint={sample ? `First bill: ${sample}` : "Up to 4 letters or digits, for example C1"}
        >
          <Input
            id="device-prefix"
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            className="tabular uppercase"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            aria-invalid={(touched || !!prefix) && !!prefixError}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {saving ? "Registering…" : "Register this device"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
