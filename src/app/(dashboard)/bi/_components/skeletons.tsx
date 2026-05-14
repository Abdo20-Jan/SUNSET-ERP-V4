import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => `kpi-${i}`).map((key) => (
        <Card key={key} size="sm" className="gap-1.5 py-2.5">
          <CardHeader className="gap-2 px-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-2.5 w-20" />
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <Card size="sm">
      <CardHeader className="gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton style={{ height }} className="w-full" />
      </CardHeader>
    </Card>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card size="sm">
      <CardHeader className="gap-2">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: rows }, (_, i) => `row-${i}`).map((key) => (
          <Skeleton key={key} className="h-4 w-full" />
        ))}
      </CardHeader>
    </Card>
  );
}
