import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"] as const;

export default function AnticiposLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Card className="py-0">
        <div className="flex flex-col gap-2 p-4">
          {SKELETON_ROWS.map((id) => (
            <Skeleton key={id} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
