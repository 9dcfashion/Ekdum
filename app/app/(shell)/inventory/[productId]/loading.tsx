import { ListPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="Loading stock history" actions={1} filters={1} columns={6} />;
}
