import { ListPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="Loading the activity log" actions={0} filters={2} columns={5} />;
}
