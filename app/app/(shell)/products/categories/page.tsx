import { PageHeader } from "@/components/shared/page-header";
import { CategoryManager } from "@/components/products/category-manager";
import { requirePage } from "@/lib/auth/context";
import { loadCategories } from "@/lib/products/queries";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const ctx = await requirePage("products.view");
  const categories = await loadCategories(ctx);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Categories"
        description="Group your products. A category can have sub-categories, one level deep."
        backHref="/app/products"
      />
      <CategoryManager
        categories={categories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id }))}
        canManage={ctx.can("products.manage")}
      />
    </div>
  );
}
