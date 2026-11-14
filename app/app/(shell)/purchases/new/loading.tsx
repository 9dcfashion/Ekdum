import { FormPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <FormPageSkeleton label="Loading the purchase form" sections={2} fields={4} />;
}
