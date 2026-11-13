"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronUp, Loader2, PauseCircle, RefreshCw, ReceiptText, Trash2 } from "lucide-react";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Decimal, formatINR } from "@/lib/money";
import {
  addProduct,
  buildSaleInput,
  cartIssues,
  changeQuantity,
  computeCart,
  emptyCart,
  hasUnsavedWork,
  patchCustomer,
  removeLine,
  setBillDiscount,
  setLineDiscount,
  setQuantity,
  setSupplyType,
  setUnitPrice,
  syncCartWithCatalog,
} from "@/lib/pos/cart";
import { toParkedBill } from "@/lib/pos/parked";
import { buildCatalogIndex } from "@/lib/pos/search";
import type {
  CartResult,
  CartState,
  CatalogProduct,
  Discount,
  ParkedBill,
  PosContext,
  PosServices,
  PosSettings,
  PostedBill,
  SubmitSaleResult,
} from "@/lib/pos/types";
import { newClientUuid } from "@/lib/pos/uuid";
import { cn } from "@/lib/utils";
import { BillSummary } from "./bill-summary";
import { CartLines, lineElementId, type CartLineHandlers } from "./cart-lines";
import { CustomerDialog } from "./customer-dialog";
import { DiscountDialog } from "./discount-dialog";
import { ParkedDialog } from "./parked-dialog";
import { PaymentDialog, type PayError, type PaymentConfirmation } from "./payment-dialog";
import { ProductSearch } from "./product-search";
import { Kbd } from "./shortcut-legend";
import { SuccessDialog } from "./success-dialog";

type DialogName = "customer" | "discount" | "pay" | "parked" | "clear" | null;

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

/** Any Radix dialog on screen, including ones this component does not own (shortcut list, outlet switch). */
const overlayIsOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/**
 * The billing screen. It gets everything through props: the catalog, the tax
 * context and a set of services (post a sale, find customers, hold bills).
 * The online POS passes Server Actions and localStorage; the offline POS can
 * pass Dexie-backed services to the very same component.
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
  const postingRef = useRef(false);

  // One client_uuid per bill: created with the cart, reused on every retry, replaced only after success or clear.
  const [rawCart, setRawCart] = useState<CartState>(() => emptyCart(newClientUuid()));
  const [sold, setSold] = useState<{ version: string; qty: Record<string, number> }>({ version: catalogVersion, qty: {} });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [payError, setPayError] = useState<PayError | null>(null);
  const [posted, setPosted] = useState<PostedBill | null>(null);
  const [parkedCount, setParkedCount] = useState(0);

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

  const focusSearch = () => searchRef.current?.focus();

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
  function addToCart(product: CatalogProduct): boolean {
    const added = apply(addProduct(cart, { ...product, stock: stockOf(product) }, ctx));
    if (added) {
      setSelectedKey(product.id);
      requestAnimationFrame(() => document.getElementById(lineElementId(product.id))?.scrollIntoView({ block: "nearest" }));
    }
    return added;
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
    if (issues.length > 0) {
      toast.error(issues[0].message);
      if (issues[0].code === "b2b_customer" || issues[0].code === "override_reason") setDialog("customer");
      return;
    }
    setDetailsOpen(false);
    setDialog("pay");
  }

  function requestClear() {
    if (dirty) setDialog("clear");
    else focusSearch();
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
    toast.success("Bill held. Find it under Held bills.");
    void refreshParkedCount();
    focusSearch();
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
    const billCart = confirmation.email ? patchCustomer(cart, { email: confirmation.email }) : cart;
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
      if (line.trackInventory) qty[line.productId] = new Decimal(qty[line.productId] ?? 0).plus(line.quantity).toNumber();
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
      changePaise: confirmation.changePaise,
    });
    setDialog(null);
    startNewBill();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    const fKey = e.key === "F2" || e.key === "F4" || e.key === "F8" || e.key === "F9";
    if (fKey) {
      // Always stop the browser's own F-key actions on this screen.
      e.preventDefault();
      if (e.repeat || overlayIsOpen()) return;
      if (e.key === "F2") {
        focusSearch();
        searchRef.current?.select();
      } else if (e.key === "F4") setDialog("customer");
      else if (e.key === "F8") openDiscount();
      else openPay();
      return;
    }
    if (e.key === "Escape") {
      // Open dialogs, the search box and cart fields handle their own Esc first.
      if (e.defaultPrevented || overlayIsOpen()) return;
      if (isTypingTarget(e.target) && e.target !== searchRef.current) return;
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
      onOpenCustomer={() => {
        setDetailsOpen(false);
        setDialog("customer");
      }}
      onSupplyType={(value) => setRawCart(setSupplyType(cart, value))}
      onOpenDiscount={() => {
        setDetailsOpen(false);
        openDiscount();
      }}
    />
  );

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Left: search + bill lines. Fixed header and footer; only the lines scroll. */}
      <section aria-label="Bill" className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          />
        </div>

        <CartLines cart={cart} ctx={ctx} selectedKey={selectedKey} handlers={lineHandlers} />

        <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-t bg-background px-2 sm:px-3">
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

      {/* Right: customer, totals and Pay. A fixed-width column on desktop. */}
      <aside aria-label="Customer and totals" className="hidden w-88 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3 lg:flex">
        {billSummary}
        {payButton("h-14 shrink-0 justify-between gap-3 px-4 text-lg")}
      </aside>

      {/* Narrow screens: the totals become a sticky bar with Pay always in reach. */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-t bg-background px-2 sm:px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="Show customer and tax details"
        >
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-xs text-muted-foreground">
              {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"} · {cart.customer?.name || (cart.customer ? "Customer" : "Walk-in")}
            </span>
            <span className={cn("block truncate text-xs", issues.length > 0 && cart.lines.length > 0 ? "text-destructive" : "text-muted-foreground")}>
              {issues.length > 0 && cart.lines.length > 0 ? issues[0].message : "Tap for customer, discount and tax"}
            </span>
          </span>
        </button>
        {payButton("h-12 shrink-0 gap-2 px-4 text-base")}
      </div>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 lg:hidden">
          <SheetHeader className="pb-2">
            <SheetTitle>Customer and totals</SheetTitle>
            <SheetDescription className="sr-only">Customer, discount and tax breakdown for this bill.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
            {billSummary}
            {payButton("h-12 shrink-0 justify-between gap-3 px-4 text-base")}
          </div>
        </SheetContent>
      </Sheet>

      <CustomerDialog
        open={dialog === "customer"}
        onOpenChange={closeDialog("customer")}
        cart={cart}
        summary={summary}
        settings={settings}
        services={services}
        onCart={setRawCart}
        onClosed={focusSearch}
      />
      <DiscountDialog
        open={dialog === "discount"}
        onOpenChange={closeDialog("discount")}
        cart={cart}
        summary={summary}
        ctx={ctx}
        onApply={applyBillDiscount}
        onClosed={focusSearch}
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
        onClosed={focusSearch}
      />
      <ParkedDialog
        open={dialog === "parked"}
        onOpenChange={closeDialog("parked")}
        store={services.parkedStore}
        currentBillInUse={dirty}
        onResume={(bill) => void resumeBill(bill)}
        onChanged={() => void refreshParkedCount()}
        onClosed={focusSearch}
      />
      <SuccessDialog
        bill={posted}
        settings={settings}
        sendEmailReceipt={services.sendEmailReceipt}
        printQueuedBill={services.printQueuedBill}
        onNewBill={() => setPosted(null)}
        onClosed={focusSearch}
      />

      <AlertDialog open={dialog === "clear"} onOpenChange={closeDialog("clear")}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusSearch();
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
