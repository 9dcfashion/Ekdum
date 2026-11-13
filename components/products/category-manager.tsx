"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { deleteCategoryAction, saveCategoryAction } from "@/app/app/(shell)/products/actions";

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

type Editing = { mode: "add"; parentId: string } | { mode: "edit"; category: Category } | null;

export function CategoryManager({ categories, canManage }: { categories: Category[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);

  const ids = new Set(categories.map((c) => c.id));
  const tops = categories.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);

  async function remove(category: Category) {
    let result;
    try {
      result = await deleteCategoryAction({ id: category.id });
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
      return false;
    }
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Category deleted");
    router.refresh();
  }

  function row(category: Category, parent: Category | null) {
    const subCount = parent ? 0 : childrenOf(category.id).length;
    return (
      <li key={category.id} className="flex items-center gap-2 px-3 py-2">
        {parent ? <CornerDownRight className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/products?category=${category.id}`}
            className="block truncate text-sm font-medium hover:text-primary hover:underline"
          >
            {category.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {parent ? `Inside ${parent.name}` : subCount > 0 ? `${subCount} sub-${subCount === 1 ? "category" : "categories"}` : "Top level"}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename ${category.name}`}
              onClick={() => setEditing({ mode: "edit", category })}
            >
              <Pencil />
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${category.name}`}>
                  <Trash2 />
                </Button>
              }
              title={`Delete ${category.name}?`}
              description={
                subCount > 0
                  ? "Products in this category will have no category, and its sub-categories will move to the top level. No products are deleted."
                  : "Products in this category will have no category. No products are deleted."
              }
              confirmLabel="Delete"
              destructive
              onConfirm={() => remove(category)}
            />
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <>
      {canManage ? (
        <div className="mb-4">
          <Button onClick={() => setEditing({ mode: "add", parentId: "" })}>
            <Plus aria-hidden /> New category
          </Button>
        </div>
      ) : null}

      {categories.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No categories yet"
          description={
            canManage
              ? "Add categories like Grocery, Clothing or Electronics to find products faster."
              : "Categories added by the owner or manager will show up here."
          }
          action={
            canManage ? (
              <Button onClick={() => setEditing({ mode: "add", parentId: "" })}>
                <Plus aria-hidden /> New category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {tops.flatMap((top) => [row(top, null), ...childrenOf(top.id).map((child) => row(child, top))])}
        </ul>
      )}

      {canManage && editing ? (
        <CategoryDialog
          // A fresh dialog (and fresh field state) for every category.
          key={editing.mode === "edit" ? editing.category.id : "add"}
          editing={editing}
          tops={tops}
          hasChildren={editing.mode === "edit" && childrenOf(editing.category.id).length > 0}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CategoryDialog({
  editing,
  tops,
  hasChildren,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  tops: Category[];
  hasChildren: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run, pending } = useAction();
  const current = editing.mode === "edit" ? editing.category : null;
  const [name, setName] = useState(current?.name ?? "");
  const [parentId, setParentId] = useState(current ? (current.parent_id ?? "") : editing.mode === "add" ? editing.parentId : "");
  const [error, setError] = useState<string | null>(null);
  const parentChoices = tops.filter((t) => t.id !== current?.id);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Category name is required");
      return;
    }
    run(() => saveCategoryAction({ id: current?.id ?? null, name, parent_id: parentId || null }), {
      success: current ? "Category saved" : "Category added",
      silentError: true,
      onSuccess: onSaved,
      onError: (message) => setError(message),
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={save} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{current ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>
              {current ? "Change the name or move it under another category." : "Group similar products so they are easier to find."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Category name" htmlFor="category_name" required error={error}>
            <Input
              id="category_name"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </Field>
          {hasChildren ? (
            <p className="text-xs text-muted-foreground">
              This category has sub-categories, so it stays at the top level.
            </p>
          ) : parentChoices.length > 0 ? (
            <Field label="Inside" htmlFor="category_parent" hint="Optional. Pick a category to make this a sub-category.">
              <NativeSelect id="category_parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">Top level</option>
                {parentChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{current ? "Save" : "Add category"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
