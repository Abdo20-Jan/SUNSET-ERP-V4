import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * RecordSection (PR-004) — bloco titulado de uma página de detalhe (record),
 * substituindo o padrão ad-hoc `<Card className="grid …">` + helper `Field`
 * duplicado em cada `[id]`. Apresentacional e server-safe (sem hooks): pode ser
 * renderizado no server component da ficha. Densidade/cor seguem os tokens do
 * PR-001 Design Foundation (texto 13px, cabeçalho small-caps discreto).
 */
export function RecordSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-[13px] text-card-foreground shadow-[0_1px_2px_rgba(20,20,20,0.04)]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {title}
              </h2>
            )}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/*
 * RecordFieldGrid + RecordField — grade responsiva de pares rótulo/valor.
 * Espeja o `<Card grid …>` + `Field` que cada página `[id]` redefine hoje
 * (proveedores/ventas/asientos), unificando o dialeto num único primitivo.
 */
export function RecordFieldGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}

export function RecordField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium break-words">{children}</span>
    </div>
  );
}
