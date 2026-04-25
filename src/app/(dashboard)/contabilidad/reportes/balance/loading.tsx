import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BalanceSumasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-48" />
      </div>

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
