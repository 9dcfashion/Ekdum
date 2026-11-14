import { FormPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <FormPageSkeleton label="Loading the purchase bill" sections={2} fields={4} />;
}
