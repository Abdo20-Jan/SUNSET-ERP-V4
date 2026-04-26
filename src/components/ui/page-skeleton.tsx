import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  title?: boolean;
  rows?: number;
  cards?: number;
  withFilters?: boolean;
};

/**
 * Skeleton genérico de página: header (título + subtítulo), filtros opcionales,
 * y una tarjeta con N filas. Usar dentro de loading.tsx para reducir
 * shift visual mientras la página resuelve queries.
 */
export function PageSkeleton({
  title = true,
  rows = 6,
  cards = 1,
  withFilters = false,
}: Props) {
  return (
    <div className="flex flex-col gap-6">
      {title && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      )}
      {withFilters && (
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-40" />
        </div>
      )}
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: rows }).map((__, j) => (
              <Skeleton key={j} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
