import { ListPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="Loading categories" actions={1} filters={0} columns={3} rows={6} />;
}
