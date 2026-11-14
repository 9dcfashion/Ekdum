import { FormPageSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return <FormPageSkeleton label="Loading the supplier form" sections={2} fields={6} />;
}
