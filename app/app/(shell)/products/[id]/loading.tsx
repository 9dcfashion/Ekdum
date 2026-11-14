import { FormPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <FormPageSkeleton label="Loading the product" sections={3} fields={6} />;
}
