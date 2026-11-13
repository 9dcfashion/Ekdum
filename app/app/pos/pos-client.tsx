"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CloudOff, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { QueuedReceipt } from "@/components/pos/offline-receipt";
import { PosScreen } from "@/components/pos/pos-screen";
import { useCatalogMeta, useDevice, useNow, useOnline } from "@/components/pos/use-offline";
import type { ActionResult } from "@/lib/actions";
import { normaliseMobile } from "@/lib/gst";
import { CATALOG_REFRESH_MINUTES, CATALOG_STALE_MS, describeAge } from "@/lib/offline/age";
import { getOfflineRepo } from "@/lib/offline/db";
import { createOfflineParkedStore } from "@/lib/offline/parked";
import { subtractUnsynced } from "@/lib/offline/queue";
import { clientUuidOfOffline, type SellerSnapshot } from "@/lib/offline/receipt";
import { submitSale } from "@/lib/offline/sale";
import { META_CUSTOMERS } from "@/lib/offline/types";
import { createLocalParkedStore } from "@/lib/pos/parked";
import type { CatalogProduct, ParkedStore, PosContext, PosServices, PosSettings, ServiceResult, SubmitSaleResult } from "@/lib/pos/types";
import {
  customerCacheAction,
  deviceSeriesAction,
  quickAddCustomerAction,
  refreshCatalogAction,
  searchCustomersAction,
  sendReceiptEmailAction,
  submitSaleAction,
} from "./actions";

const OFFLINE_MESSAGE = "Could not reach the server. Check your connection and try again.";
/** A post that has not answered by now is treated as "no network": the bill is saved on the device instead. */
const ONLINE_POST_TIMEOUT_MS = 20_000;
const REFRESH_MS = CATALOG_REFRESH_MINUTES * 60_000;

type NetResult<T> = ServiceResult<T> & { network?: boolean };

/** Server Actions never throw on purpose; a throw here means the request itself failed. */
async function call<T>(action: () => Promise<ActionResult<T>>): Promise<NetResult<T>> {
  try {
    const result = await action();
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  } catch {
    return { ok: false, error: OFFLINE_MESSAGE, network: true };
  }
}

async function postOnline(input: Parameters<typeof submitSaleAction>[0]): Promise<SubmitSaleResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SubmitSaleResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: "network", message: OFFLINE_MESSAGE }), ONLINE_POST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([submitSaleAction(input), timeout]);
  } catch {
    // The request never got an answer. The bill may or may not exist; a retry with the same client_uuid is safe.
    return { ok: false, code: "network", message: OFFLINE_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

/** Held bills live in the offline database; localStorage is the fallback where it cannot be opened. */
function lazyParkedStore(businessId: string, outletId: string): ParkedStore {
  let store: ParkedStore | null = null;
  const get = () => {
    if (!store) {
      const scope = `${businessId}.${outletId}`;
      const repo = getOfflineRepo(businessId);
      store = repo ? createOfflineParkedStore(repo, outletId, scope) : createLocalParkedStore(scope);
    }
    return store;
  };
  return { list: () => get().list(), save: (bill) => get().save(bill), remove: (id) => get().remove(id) };
}

interface Snapshot {
  catalog: CatalogProduct[];
  version: string;
}

/**
 * The wiring of the POS. Online it talks to Server Actions exactly as before.
 * On top of that it keeps a copy of the catalog and customers on the device,
 * and, on a registered device, numbers bills locally and saves them to a queue
 * when the network is not there.
 */
export function PosClient({
  catalog,
  catalogVersion,
  context,
  settings,
  scope,
  seller,
}: {
  catalog: CatalogProduct[];
  /** Server time of this catalog. Empty for the offline shell page, which carries no products. */
  catalogVersion: string;
  context: PosContext;
  settings: PosSettings;
  scope: { businessId: string; outletId: string };
  seller: SellerSnapshot;
}) {
  const { businessId, outletId } = scope;
  const online = useOnline();
  const now = useNow();
  const device = useDevice(businessId, outletId);
  const catalogMeta = useCatalogMeta(businessId, outletId);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const refreshingRef = useRef(false);

  // Created once: the services keep the same identity for the life of the screen.
  const [services] = useState<PosServices>(() => ({
    submitSale: (input) =>
      submitSale(
        {
          repo: getOfflineRepo(businessId),
          outletId,
          context,
          seller,
          // The slip is the only format that can be printed with no server.
          printFormat: settings.defaultPrintFormat === "thermal_58" ? "thermal_58" : "thermal_80",
          postOnline,
          isOnline: () => navigator.onLine,
          now: () => new Date(),
          async fetchServerSeries(deviceId) {
            const result = await call(() => deviceSeriesAction({ device_id: deviceId }));
            return result.ok ? { active: result.data.active, series: result.data.series } : null;
          },
        },
        input,
      ),
    async searchCustomers(query) {
      if (navigator.onLine) {
        const result = await call(() => searchCustomersAction(query));
        if (result.ok || !result.network) return result;
      }
      // No network: look in the customers saved on this device.
      const repo = getOfflineRepo(businessId);
      if (!repo) return { ok: false, error: OFFLINE_MESSAGE };
      try {
        return { ok: true, data: await repo.searchCustomers(query, 8) };
      } catch {
        return { ok: false, error: OFFLINE_MESSAGE };
      }
    },
    async createCustomer(input) {
      if (navigator.onLine) {
        const result = await call(() => quickAddCustomerAction(input));
        if (result.ok || !result.network) return result;
      }
      // No network: the details go on this bill only. No customer record, so no credit.
      return {
        ok: true,
        data: {
          id: "",
          name: input.name.trim(),
          phone: normaliseMobile(input.phone) ?? input.phone.trim(),
          email: input.email?.trim() || null,
          gstin: input.gstin?.trim() || null,
          address: null,
          pincode: null,
          state_code: input.state_code || null,
          whatsapp_opt_in: false,
        },
      };
    },
    sendEmailReceipt: (invoiceId, email) => call(() => sendReceiptEmailAction({ invoice_id: invoiceId, email })),
    parkedStore: lazyParkedStore(businessId, outletId),
    printQueuedBill: (invoiceId) => setReceiptFor(clientUuidOfOffline(invoiceId)),
  }));

  /** Save a server catalog on the device, less the bills that are still waiting here. */
  async function adopt(fresh: CatalogProduct[], version: string): Promise<CatalogProduct[]> {
    const repo = getOfflineRepo(businessId);
    if (!repo) return fresh;
    try {
      const adjusted = subtractUnsynced(fresh, await repo.listQueue(), outletId);
      await repo.saveCatalog(outletId, adjusted, { version, savedAt: Date.now(), count: adjusted.length });
      return adjusted;
    } catch {
      return fresh; // storage full or blocked: the till still works online
    }
  }

  async function refreshCustomers(force: boolean) {
    const repo = getOfflineRepo(businessId);
    if (!repo || !settings.canViewCustomers || !navigator.onLine) return;
    try {
      const savedAt = (await repo.getMeta<number>(META_CUSTOMERS)) ?? 0;
      if (!force && Date.now() - savedAt < REFRESH_MS) return;
      const result = await call(() => customerCacheAction());
      if (!result.ok) return;
      await repo.saveCustomers(result.data);
      await repo.setMeta(META_CUSTOMERS, Date.now());
    } catch {
      // The lookup simply stays online-only.
    }
  }

  async function refresh(manual: boolean) {
    await Promise.resolve();
    if (refreshingRef.current) return;
    if (!navigator.onLine) {
      if (manual) toast.error("You are offline. The till keeps using the catalog saved on this device.");
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const result = await call(() => refreshCatalogAction({ outlet_id: outletId }));
      if (result.ok) {
        setSnapshot({ catalog: await adopt(result.data.catalog, result.data.version), version: result.data.version });
        if (manual) toast.success("Catalog updated");
      } else if (manual) {
        toast.error(result.network ? "Could not refresh. The till keeps using the saved catalog." : result.error);
      }
      void refreshCustomers(manual);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  /** On load: keep whichever is newer, the page's catalog or the one saved on the device. */
  async function start() {
    const repo = getOfflineRepo(businessId);
    const meta = repo ? await repo.getCatalogMeta(outletId).catch(() => undefined) : undefined;
    if (catalogVersion && (!meta || catalogVersion > meta.version)) {
      const adjusted = await adopt(catalog, catalogVersion);
      if (adjusted !== catalog) setSnapshot({ catalog: adjusted, version: catalogVersion });
    } else if (repo && meta) {
      const saved = await repo.loadCatalog(outletId).catch(() => null);
      if (saved) setSnapshot({ catalog: saved, version: meta.version });
    }
    // The offline shell came up although there is a network (slow connection): fetch live data now.
    if (!catalogVersion) void refresh(false);
    else void refreshCustomers(false);
    // Keep the offline copy of this page current for this user and outlet.
    if (navigator.onLine && "serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration().then((registration) => registration?.active?.postMessage({ type: "EKDUM_WARM_POS" }));
    }
  }

  const onStart = useEffectEvent(() => void start());
  const onTick = useEffectEvent(() => {
    if (document.visibilityState === "visible") void refresh(false);
  });
  useEffect(() => {
    // Deferred a tick: loading from the device database is asynchronous work, not part of rendering.
    const kick = setTimeout(() => onStart(), 0);
    const timer = setInterval(() => onTick(), REFRESH_MS);
    const onOnline = () => onTick();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const active: Snapshot = snapshot ?? { catalog, version: catalogVersion };
  const registered = !!device && !device.revoked;
  const age = catalogMeta && now > 0 ? describeAge(catalogMeta.savedAt, now) : null;
  const stale = !!catalogMeta && now > 0 && now - catalogMeta.savedAt > CATALOG_STALE_MS;

  let banner: { tone: "amber" | "red"; icon: typeof CloudOff; text: string } | null = null;
  if (!online && device !== undefined && !registered) {
    banner = {
      tone: "red",
      icon: CloudOff,
      text: "You are offline and this device is not registered, so bills cannot be saved. Register it in Settings → POS devices when you are back online.",
    };
  } else if (!online) {
    banner = {
      tone: "amber",
      icon: CloudOff,
      text: `Offline. Bills are saved on this device and will sync later.${age ? ` Prices and stock are from the catalog saved ${age}.` : ""}`,
    };
  } else if (active.catalog.length === 0 && !catalogVersion && !refreshing) {
    banner = { tone: "amber", icon: PackageSearch, text: "No catalog is saved on this device yet. Press Refresh catalog to load your products." };
  } else if (stale && snapshot && !refreshing) {
    banner = { tone: "amber", icon: PackageSearch, text: `Prices and stock were last updated ${age}. Press Refresh catalog to update them.` };
  }

  return (
    <div className="flex h-full flex-col">
      {banner ? (
        <p
          role="status"
          className={
            banner.tone === "red"
              ? "no-print flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-800"
              : "no-print flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900"
          }
        >
          <banner.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {banner.text}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <PosScreen
          key={context.outletId}
          catalog={active.catalog}
          catalogVersion={active.version}
          context={context}
          settings={settings}
          services={services}
          refreshing={refreshing}
          onRefreshCatalog={() => void refresh(true)}
        />
      </div>
      <QueuedReceipt businessId={businessId} clientUuid={receiptFor} autoPrint onClose={() => setReceiptFor(null)} />
    </div>
  );
}
