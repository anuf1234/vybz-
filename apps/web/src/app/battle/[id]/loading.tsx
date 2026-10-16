import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading battle" className="space-y-4 pt-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-14" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="aspect-[3/4]" />
        <Skeleton className="aspect-[3/4]" />
      </div>
    </div>
  );
}
