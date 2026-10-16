import { LoadingList, Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="space-y-6 pt-10">
      <Skeleton className="h-10 w-48" />
      <LoadingList rows={4} />
    </div>
  );
}
