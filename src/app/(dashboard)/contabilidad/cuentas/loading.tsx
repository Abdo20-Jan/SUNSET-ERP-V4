import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlanCuentasLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <Card className="py-0">
        <div className="flex flex-col gap-1.5 p-4">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-8 w-full"
              style={{ marginLeft: `${(i % 4) * 12}px` }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
