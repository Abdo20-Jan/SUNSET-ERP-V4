import { Fragment, type ReactNode } from "react";
import Link from "next/link";

type Crumb = { label: string; href?: string };

// Cabecera normalizada de una página de detalle (record): breadcrumb + título
// (densidad text-[15px] del ERP) + badge de estado + acciones + subtítulo.
// Unifica los 3 dialectos de header sueltos en las páginas [id].
export function RecordHeader({
  breadcrumb,
  title,
  subtitle,
  status,
  actions,
}: {
  breadcrumb?: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {breadcrumb.map((crumb, i) => (
            <Fragment key={crumb.href ?? crumb.label}>
              {i > 0 && <span aria-hidden>/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
