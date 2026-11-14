"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Loader2, PackagePlus, PauseCircle, RefreshCw, ReceiptText, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { normaliseMobile } from "@/lib/gst";
import { Decimal, formatINR } from "@/lib/money";
import {
  addManualItem,
  addProduct,
  attachCustomerRecord,
  buildSaleInput,
  cartIssues,
  changeQuantity,
  computeCart,
  emptyCart,
  hasUnsavedWork,
  patchCustomer,
  removeLine,
  restoreLine,
  setBillDiscount,
  setLineDiscount,
  setQuantity,
  setSupplyType,
  setUnitPrice,
  syncCartWithCatalog,
} from "@/lib/pos/cart";
import { toParkedBill } from "@/lib/pos/parked";
import { matchScannedCode, parseRecent, pushRecent, recentStorageKey } from "@/lib/pos/quick-bill";
import { buildCatalogIndex } from "@/lib/pos/search";
import type {
  CartResult,
  CartState,
  CatalogProduct,
  Discount,
  ManualItemInput,
  ParkedBill,
  PosContext,
  PosServices,
  PosSettings,
  PostedBill,
  QuickItem,
  SubmitSaleResult,
} from "@/lib/pos/types";
import { newClientUuid } from "@/lib/pos/uuid";
import { BillSheet, type BillSheetHandlers } from "./bill-sheet";
import { BillSummary } from "./bill-summary";
import { CameraScanner, type ScanOutcome } from "./camera-scanner";
import { CartLines, lineElementId, type CartLineHandlers } from "./cart-lines";
import { CustomerDialog } from "./customer-dialog";
import { DiscountDialog } from "./discount-dialog";
import { ManualItemDialog } from "./manual-item-dialog";
import { ParkedDialog } from "./parked-dialog";
import { PaymentDialog, type CustomerChoice, type PayError, type PaymentConfirmation } from "./payment-dialog";
import { ProductSearch } from "./product-search";
import { QuickBill } from "./quick-bill";
import { QuickItemDialog } from "./quick-item-dialog";
import { QuickPaySheet } from "./quick-pay-sheet";
import { Kbd } from "./shortcut-legend";
import { SuccessDialog } from "./success-dialog";
import { isDesktopNow, readStored, useIsDesktop, useStoredValue, writeStored } from "./use-quick-bill";

type DialogName = "customer" | "discount" | "pay" | "parked" | "clear" | "manual" | null;

/** Put the customer chosen on the phone pay screen on the bill. */
function applyCustomerChoice(cart: CartState, choice: CustomerChoice | undefined): CartState {
  if (!choice) return cart;
  return choice.kind === "record" ? attachCustomerRecord(cart, choice.record) : patchCustomer(cart, { phone: choice.phone });
}

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

/** Any Radix dialog on screen, including ones this component does not own (shortcut list, outlet switch). */
const overlayIsOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/**
 * The billing screen. It gets everything through props: the catalog, the tax
 * context and a set of services (post a sale, find customers, hold bills).
 * The online POS passes Server Actions and localStorage; the offline POS can
 * pass Dexie-backed services to the very same component.
 *
 * Two layouts share all of the state and rules below: at `lg` and up the
 * keyboard-first desktop screen (search, bill lines, totals column, dialogs);
 * below it the phone "quick bill" flow (tiles, bill sheet, pay sheet).
 */
export function PosScreen({
  catalog,
  catalogVersion,
  context: ctx,
  settings,
  services,
  onRefreshCatalog,
  refreshing = false,
}: {
  catalog: CatalogProduct[];
  /** Changes whenever a fresh catalog arrives (stock sold since then is counted locally). */
  catalogVersion: string;
  context: PosContext;
  settings: PosSettings;
  services: PosServices;
  onRefreshCatalog?: () => void;
  refreshing?: boolean;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const postingRef = useRef(false);

  // One client_uuid per bill: created with the cart, reused on every retry, replaced only after success or clear.
  const [rawCart, setRawCart] = useState<CartState>(() => emptyCart(newClientUuid()));
  const [sold, setSold] = useState<{ version: string; qty: Record<string, number> }>({ version: catalogVersion, qty: {} });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  // Phone flow. Kept apart from `dialog` so the customer or discount dialog can open on top of these sheets.
  const [billOpen, setBillOpen] = useState(false);
  const [quickPayOpen, setQuickPayOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [quickItem, setQuickItem] = useState<QuickItem | null>(null);
  const [posting, setPosting] = useState(false);
  const [payError, setPayError] = useState<PayError | null>(null);
  const [posted, setPosted] = useState<PostedBill | null>(null);
  const [parkedCount, setParkedCount] = useState(0);
  const [manualName, setManualName] = useState("");

  // ── Derived state ─────────────────────────────────────────────────────────
  const index = buildCatalogIndex(catalog);
  const soldQty = sold.version === catalogVersion ? sold.qty : {};
  const soldOf = (productId: string) => soldQty[productId] ?? 0;
  const stockOf = (p: CatalogProduct) => (p.stock === null ? null : new Decimal(p.stock).minus(soldOf(p.id)).toNumber());
  // Lines always follow the latest catalog: a refresh updates prices, tax rates and stock in place.
  const cart = syncCartWithCatalog(rawCart, (id) => index.byId.get(id), soldOf);
  const summary = computeCart(cart, ctx);
  const issues = cartIssues(cart, ctx, summary);
  const total = summary.totals.totalPaise;
  const dirty = hasUnsavedWork(cart);
  const isDesktop = useIsDesktop();
  const recentKey = recentStorageKey(settings.businessId, ctx.outletId);
  const recentRaw = useStoredValue(recentKey);
  const recentIds = parseRecent(recentRaw);
  // Only for a catalog that really came from the server: the offline shell starts empty while the saved one loads.
  const nothingToSell = catalogVersion !== "" && catalog.length === 0 && settings.quickItems.length === 0;

  const focusSearch = () => searchRef.current?.focus();
  /**
   * After a dialog closes. Desktop: back to the search box, ready for the next scan.
   * Phone: false, so focus goes back to the button that opened it (focusing the
   * search box there would pop the keyboard over the screen).
   */
  const afterDialog = () => {
    if (!isDesktopNow()) return false;
    focusSearch();
  };

  function apply(result: CartResult): boolean {
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setRawCart(result.cart);
    return true;
  }

  function startNewBill() {
    setRawCart(emptyCart(newClientUuid()));
    setSelectedKey(null);
    setPayError(null);
  }

  // ── Cart actions ──────────────────────────────────────────────────────────
  /** Add one of a product. Returns why it could not be added, or null. */
  function tryAddProduct(product: CatalogProduct): string | null {
    const result = addProduct(cart, { ...product, stock: stockOf(product) }, ctx);
    if (!result.ok) return result.error;
    setRawCart(result.cart);
    setSelectedKey(product.id);
    requestAnimationFrame(() => document.getElementById(lineElementId(product.id))?.scrollIntoView({ block: "nearest" }));
    return null;
  }

  function addToCart(product: CatalogProduct): boolean {
    const error = tryAddProduct(product);
    if (error) toast.error(error);
    return error === null;
  }

  /** A code read by the phone camera: same rules as a scanner (barcode, then SKU), never a guess. */
  function addScanned(code: string): ScanOutcome {
    const product = matchScannedCode(index, code);
    if (!product) return { ok: false, message: `No item has the code ${code}. Try again, or close this and search by name.` };
    const error = tryAddProduct(product);
    return error ? { ok: false, message: error } : { ok: true, message: `${product.name} added to the bill.` };
  }

  /** An item that is not in the product list. Returns an error message, or null when it was added. */
  function addManual(input: ManualItemInput): string | null {
    const result = addManualItem(cart, input, ctx);
    if (!result.ok) return result.error;
    setRawCart(result.cart);
    setSelectedKey(input.key);
    requestAnimationFrame(() => document.getElementById(lineElementId(input.key))?.scrollIntoView({ block: "nearest" }));
    return null;
  }

  function openManual(name = "") {
    setManualName(name.trim());
    setDialog("manual");
  }

  function adjustSelected(delta: number) {
    const key = selectedKey ?? cart.lines.at(-1)?.key;
    if (!key) return;
    setSelectedKey(key);
    apply(changeQuantity(cart, key, delta, ctx));
  }

  const lineHandlers: CartLineHandlers = {
    onSelect: setSelectedKey,
    onSetQuantity: (key, quantity) => apply(setQuantity(cart, key, quantity, ctx)),
    onChangeQuantity: (key, delta) => void apply(changeQuantity(cart, key, delta, ctx)),
    onSetPrice: (key, paise) => apply(setUnitPrice(cart, key, paise, ctx)),
    onSetDiscount: (key, discount) => apply(setLineDiscount(cart, key, discount, ctx)),
    onRemove: (key) => {
      setRawCart(removeLine(cart, key));
      if (selectedKey === key) setSelectedKey(null);
    },
    onInvalid: (message) => void toast.error(message),
    focusSearch,
  };

  /** Phone: remove at once and offer Undo, instead of asking "are you sure?". */
  function removeWithUndo(key: string) {
    const position = cart.lines.findIndex((l) => l.key === key);
    if (position < 0) return;
    const line = cart.lines[position];
    const clientUuid = cart.clientUuid;
    setRawCart(removeLine(cart, key));
    if (selectedKey === key) setSelectedKey(null);
    toast(`Removed ${line.name}`, {
      duration: 6000,
      action: { label: "Undo", onClick: () => setRawCart((current) => restoreLine(current, { clientUuid, line, index: position })) },
    });
  }

  const billSheetHandlers: BillSheetHandlers = {
    onChangeQuantity: lineHandlers.onChangeQuantity,
    onSetQuantity: lineHandlers.onSetQuantity,
    onSetPrice: lineHandlers.onSetPrice,
    onSetDiscount: lineHandlers.onSetDiscount,
    onRemove: removeWithUndo,
    onInvalid: lineHandlers.onInvalid,
  };

  function applyBillDiscount(discount: Discount): string | null {
    const result = setBillDiscount(cart, discount, ctx);
    if (!result.ok) return result.error;
    setRawCart(result.cart);
    return null;
  }

  // ── Dialogs ───────────────────────────────────────────────────────────────
  function openDiscount() {
    if (!ctx.canDiscount) return void toast.error("Your role is not allowed to give discounts");
    if (cart.lines.length === 0) return void toast.error("Add an item before giving a discount");
    setDialog("discount");
  }

  function openPay() {
    if (postingRef.current) return;
    const desktop = isDesktopNow();
    if (issues.length > 0) {
      toast.error(issues[0].message);
      if (issues[0].code === "b2b_customer" || issues[0].code === "override_reason") setDialog("customer");
      else if (!desktop && issues[0].lineKey) setBillOpen(true); // show the item with the problem
      return;
    }
    if (desktop) {
      setDialog("pay");
    } else {
      // The bill sheet (if open) stays underneath, so Back on the pay screen returns to it.
      setQuickPayOpen(true);
    }
  }

  /** Phone pay screen → the full payment dialog, for splitting across modes. */
  function openSplit(choice: CustomerChoice | undefined) {
    const next = applyCustomerChoice(cart, choice);
    if (next !== cart) setRawCart(next);
    setQuickPayOpen(false);
    setDialog("pay");
  }

  function requestClear() {
    if (dirty) setDialog("clear");
    else if (isDesktopNow()) focusSearch();
  }

  // ── Held bills ────────────────────────────────────────────────────────────
  async function refreshParkedCount() {
    try {
      setParkedCount((await services.parkedStore.list()).length);
    } catch {
      setParkedCount(0);
    }
  }

  async function holdBill() {
    if (cart.lines.length === 0) return void toast.error("There is nothing to hold yet");
    try {
      await services.parkedStore.save(toParkedBill(cart, total));
    } catch (error) {
      return void toast.error(error instanceof Error ? error.message : "Could not hold the bill");
    }
    startNewBill();
    setBillOpen(false);
    toast.success("Bill held. Find it under Held bills.");
    void refreshParkedCount();
    if (isDesktopNow()) focusSearch();
  }

  async function resumeBill(bill: ParkedBill) {
    setRawCart({ ...emptyCart(bill.cart.clientUuid), ...bill.cart });
    setSelectedKey(null);
    setPayError(null);
    setDialog(null);
    try {
      await services.parkedStore.remove(bill.id);
    } catch {
      toast.error("The bill is back on screen, but it could not be removed from Held bills");
    }
    void refreshParkedCount();
  }

  // ── Posting ───────────────────────────────────────────────────────────────
  async function confirmPayment(confirmation: PaymentConfirmation) {
    // The ref (not state) is the guard: a double click or key repeat arrives before React re-renders.
    if (postingRef.current) return;
    const withCustomer = applyCustomerChoice(cart, confirmation.customer);
    const billCart = confirmation.email ? patchCustomer(withCustomer, { email: confirmation.email }) : withCustomer;
    const built = buildSaleInput(billCart, ctx, confirmation.payments, confirmation.options);
    if (!built.ok) return setPayError({ code: "invalid", message: built.error });

    postingRef.current = true;
    setPosting(true);
    setPayError(null);
    if (billCart !== cart) setRawCart(billCart);

    let result: SubmitSaleResult;
    try {
      result = await services.submitSale(built.input);
    } catch {
      result = { ok: false, code: "network", message: "Could not reach the server. Check your connection and try again." };
    }
    postingRef.current = false;
    setPosting(false);

    if (!result.ok) {
      // The cart and its client_uuid stay exactly as they are, so "Try again" can never make a second bill.
      setPayError({ code: result.code, message: result.message });
      return;
    }

    const qty = { ...soldQty };
    for (const line of billCart.lines) {
      if (line.trackInventory && line.productId) qty[line.productId] = new Decimal(qty[line.productId] ?? 0).plus(line.quantity).toNumber();
    }
    setSold({ version: catalogVersion, qty });
    setPosted({
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      publicToken: result.publicToken,
      totalPaise: built.summary.totals.totalPaise,
      documentType: built.summary.documentType,
      duplicate: result.duplicate,
      queued: !!result.queued,
      warnings: result.warnings,
      emailQueued: !!built.input.notify?.email && !result.duplicate,
      whatsappQueued: !!built.input.notify?.whatsapp && !result.duplicate,
      customerEmail: billCart.customer?.email ?? "",
      customerPhone: normaliseMobile(billCart.customer?.phone) ?? "",
      changePaise: confirmation.changePaise,
    });
    setDialog(null);
    setQuickPayOpen(false);
    setBillOpen(false);
    startNewBill();
    // "Recent" tiles on the phone screen: what this device billed last comes first.
    writeStored(recentKey, JSON.stringify(pushRecent(parseRecent(readStored(recentKey)), billCart.lines.map((l) => l.productId).reverse())));
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    const fKey = e.key === "F2" || e.key === "F4" || e.key === "F6" || e.key === "F8" || e.key === "F9";
    if (fKey) {
      // Always stop the browser's own F-key actions on this screen.
      e.preventDefault();
      if (e.repeat || overlayIsOpen()) return;
      if (e.key === "F2") {
        const input = isDesktopNow() ? searchRef.current : mobileSearchRef.current;
        input?.focus();
        input?.select();
      } else if (e.key === "F4") setDialog("customer");
      else if (e.key === "F6") openManual();
      else if (e.key === "F8") openDiscount();
      else openPay();
      return;
    }
    if (e.key === "Escape") {
      // Open dialogs, the search box and cart fields handle their own Esc first.
      if (e.defaultPrevented || overlayIsOpen()) return;
      if (isTypingTarget(e.target) && e.target !== searchRef.current && e.target !== mobileSearchRef.current) return;
      e.preventDefault();
      requestClear();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Warn before a reload or tab close throws away a bill in progress.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parkedStore = services.parkedStore;
  useEffect(() => {
    let cancelled = false;
    parkedStore.list().then(
      (bills) => !cancelled && setParkedCount(bills.length),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [parkedStore]);

  const closeDialog = (name: Exclude<DialogName, null>) => (open: boolean) => setDialog(open ? name : null);

  const payButton = (className: string) => (
    <Button
      type="button"
      size="lg"
      className={className}
      disabled={cart.lines.length === 0 || posting}
      onClick={openPay}
      aria-keyshortcuts="F9"
    >
      <span>Pay</span>
      <span className="tabular">{formatINR(total)}</span>
      <Kbd>F9</Kbd>
    </Button>
  );

  const billSummary = (
    <BillSummary
      cart={cart}
      summary={summary}
      ctx={ctx}
      issues={issues}
      onOpenCustomer={() => setDialog("customer")}
      onSupplyType={(value) => setRawCart(setSupplyType(cart, value))}
      onOpenDiscount={openDiscount}
    />
  );

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Desktop (lg and up), left: search + bill lines. Fixed header and footer; only the lines scroll. */}
      <section aria-label="Bill" className="hidden min-h-0 min-w-0 flex-1 flex-col lg:flex">
        <div className="shrink-0 border-b bg-background p-2 sm:p-3">
          <ProductSearch
            index={index}
            inputRef={searchRef}
            stockOf={stockOf}
            onAdd={addToCart}
            onMoveToCart={() => {
              const key = selectedKey ?? cart.lines[0]?.key;
              if (key) document.getElementById(lineElementId(key))?.focus();
            }}
            onAdjustSelected={adjustSelected}
            onAddManual={openManual}
          />
          {settings.quickItems.length > 0 ? (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Quick items">
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                <Zap className="size-3.5" aria-hidden /> Quick
              </span>
              {settings.quickItems.map((item) => (
                <Button key={item.id} type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setQuickItem(item)}>
                  {item.name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <CartLines
          cart={cart}
          ctx={ctx}
          selectedKey={selectedKey}
          handlers={lineHandlers}
          nothingToSell={nothingToSell}
        />

        <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-t bg-background px-2 sm:px-3">
          <Button type="button" variant="outline" onClick={() => openManual()} aria-keyshortcuts="F6" title="Bill something that is not in your product list">
            <PackagePlus aria-hidden /> Not in list <Kbd>F6</Kbd>
          </Button>
          <Button type="button" variant="outline" onClick={() => void holdBill()} disabled={cart.lines.length === 0}>
            <PauseCircle aria-hidden /> Hold
          </Button>
          <Button type="button" variant="outline" onClick={() => setDialog("parked")}>
            <ReceiptText aria-hidden /> Held bills
            <span className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs">{parkedCount}</span>
          </Button>
          <Button type="button" variant="ghost" onClick={requestClear} disabled={!dirty}>
            <Trash2 aria-hidden /> Clear <Kbd>Esc</Kbd>
          </Button>
          {onRefreshCatalog ? (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              onClick={onRefreshCatalog}
              disabled={refreshing}
              title="Load the latest prices and stock"
            >
              {refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              <span className="hidden sm:inline">Refresh catalog</span>
              <span className="sr-only sm:hidden">Refresh catalog</span>
            </Button>
          ) : null}
        </div>
      </section>

      {/* Desktop, right: customer, totals and Pay. A fixed-width column. */}
      <aside aria-label="Customer and totals" className="hidden w-88 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3 lg:flex">
        {billSummary}
        {payButton("h-14 shrink-0 justify-between gap-3 px-4 text-lg")}
      </aside>

      {/* Phones and small tablets: tap tiles to add, sticky bill bar with Pay. */}
      <QuickBill
        index={index}
        catalog={catalog}
        cart={cart}
        summary={summary}
        issues={issues}
        ctx={ctx}
        settings={settings}
        recentIds={recentIds}
        nothingToSell={nothingToSell}
        stockOf={stockOf}
        searchRef={mobileSearchRef}
        parkedCount={parkedCount}
        posting={posting}
        refreshing={refreshing}
        onRefreshCatalog={onRefreshCatalog}
        onAddProduct={addToCart}
        onOpenManual={openManual}
        onOpenQuickItem={setQuickItem}
        onOpenScanner={() => setScanOpen(true)}
        onOpenBill={() => setBillOpen(true)}
        onOpenParked={() => setDialog("parked")}
        onPay={openPay}
      />

      <BillSheet
        open={billOpen}
        onOpenChange={setBillOpen}
        cart={cart}
        summary={summary}
        ctx={ctx}
        issues={issues}
        handlers={billSheetHandlers}
        parkedCount={parkedCount}
        dirty={dirty}
        posting={posting}
        onOpenCustomer={() => setDialog("customer")}
        onOpenDiscount={openDiscount}
        onHold={() => void holdBill()}
        onOpenParked={() => setDialog("parked")}
        onClear={requestClear}
        onPay={openPay}
      />
      <QuickPaySheet
        open={quickPayOpen}
        onOpenChange={setQuickPayOpen}
        cart={cart}
        summary={summary}
        settings={settings}
        services={services}
        posting={posting}
        error={payError}
        onConfirm={(confirmation) => void confirmPayment(confirmation)}
        onSplit={openSplit}
        onOpenCustomer={() => setDialog("customer")}
        onRefreshCatalog={
          onRefreshCatalog
            ? () => {
                setQuickPayOpen(false);
                setPayError(null);
                onRefreshCatalog();
              }
            : undefined
        }
      />
      <CameraScanner open={scanOpen} onOpenChange={setScanOpen} onDetected={addScanned} />
      <QuickItemDialog
        item={quickItem}
        variant={isDesktop ? "dialog" : "sheet"}
        onOpenChange={(open) => !open && setQuickItem(null)}
        onClosed={afterDialog}
        ctx={ctx}
        businessId={settings.businessId}
        onAdd={addManual}
      />

      <CustomerDialog
        open={dialog === "customer"}
        onOpenChange={closeDialog("customer")}
        cart={cart}
        summary={summary}
        settings={settings}
        services={services}
        onCart={setRawCart}
        onClosed={afterDialog}
      />
      <DiscountDialog
        open={dialog === "discount"}
        onOpenChange={closeDialog("discount")}
        cart={cart}
        summary={summary}
        ctx={ctx}
        onApply={applyBillDiscount}
        onClosed={afterDialog}
      />
      <PaymentDialog
        open={dialog === "pay"}
        onOpenChange={closeDialog("pay")}
        cart={cart}
        summary={summary}
        settings={settings}
        posting={posting}
        error={payError}
        onConfirm={(confirmation) => void confirmPayment(confirmation)}
        onRefreshCatalog={
          onRefreshCatalog
            ? () => {
                setDialog(null);
                setPayError(null);
                onRefreshCatalog();
              }
            : undefined
        }
        onClosed={afterDialog}
      />
      <ManualItemDialog
        open={dialog === "manual"}
        initialName={manualName}
        onOpenChange={closeDialog("manual")}
        ctx={ctx}
        settings={settings}
        onAdd={addManual}
        onClosed={afterDialog}
      />
      <ParkedDialog
        open={dialog === "parked"}
        onOpenChange={closeDialog("parked")}
        store={services.parkedStore}
        currentBillInUse={dirty}
        onResume={(bill) => void resumeBill(bill)}
        onChanged={() => void refreshParkedCount()}
        onClosed={afterDialog}
      />
      <SuccessDialog
        bill={posted}
        variant={isDesktop ? "dialog" : "screen"}
        settings={settings}
        sendEmailReceipt={services.sendEmailReceipt}
        printQueuedBill={services.printQueuedBill}
        onNewBill={() => setPosted(null)}
        onClosed={afterDialog}
      />

      <AlertDialog open={dialog === "clear"} onOpenChange={closeDialog("clear")}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            if (afterDialog() !== false) e.preventDefault();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              All items and the customer will be removed. Use Hold instead if the customer is coming back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the bill</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                startNewBill();
                setDialog(null);
                setBillOpen(false);
              }}
            >
              Clear bill
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
