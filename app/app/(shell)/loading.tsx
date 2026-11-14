import { ListPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="Loading" actions={1} filters={1} />;
}
