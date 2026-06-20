import { Children, type ReactNode } from "react";
import Link from "next/link";

// Lista de "related records" de un detalle (compras, pagos, anticipos…). Muestra
// un empty state cuando no hay hijos. Cada fila es un <RelatedItem>.
export function RelatedList({ emptyText, children }: { emptyText: string; children?: ReactNode }) {
  const isEmpty = Children.toArray(children).length === 0;
  if (isEmpty) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return <div className="flex flex-col gap-2">{children}</div>;
}

// Fila de related record: título + subtítulo a la izquierda, contenido trailing
// (monto, StatusBadge…) a la derecha. Si hay href, toda la fila es un link.
export function RelatedItem({
  href,
  title,
  subtitle,
  trailing,
}: {
  href?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  const inner = (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{title}</span>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="block transition-colors hover:bg-accent">
      {inner}
    </Link>
  );
}
