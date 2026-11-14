"use client";

import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteProductAction, setProductActiveAction } from "@/app/app/(shell)/products/actions";

/** Deactivate / activate (soft) and delete (only works for products with no history). */
export function ProductStatusActions({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const router = useRouter();

  async function setActive(next: boolean) {
    let result;
    try {
      result = await setProductActiveAction({ id, is_active: next });
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
      return false;
    }
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(next ? "Product is active again" : "Product deactivated");
    router.refresh();
  }

  async function remove() {
    let result;
    try {
      result = await deleteProductAction({ id });
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
      return false;
    }
    if (!result.ok) {
      toast.error(result.error);
      // Close the dialog: the message tells the user to deactivate instead.
      return;
    }
    toast.success("Product deleted");
    router.push("/app/products");
  }

  return (
    <section className="mt-6 rounded-xl border p-4">
      <h2 className="text-sm font-semibold">Remove from billing</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Deactivating hides the product from billing and keeps all its bills and stock history. Deleting is only
        possible for a product that has never been billed, purchased or stocked.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isActive ? (
          <ConfirmDialog
            trigger={<Button variant="outline">Deactivate</Button>}
            title={`Deactivate ${name}?`}
            description="It will no longer show up when billing. You can activate it again at any time."
            confirmLabel="Deactivate"
            onConfirm={() => setActive(false)}
          />
        ) : (
          <Button variant="outline" onClick={() => void setActive(true)}>
            Activate
          </Button>
        )}
        <ConfirmDialog
          trigger={<Button variant="destructive">Delete</Button>}
          title={`Delete ${name}?`}
          description="This removes the product for good and cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={remove}
        />
      </div>
    </section>
  );
}
