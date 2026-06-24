import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * RecordLayout (PR-004) — scaffold padronizado de uma página de detalhe (record).
 * Compõe o `RecordHeader` JÁ EXISTENTE (src/components/layout/record-header.tsx,
 * série NS-4) passado via slot `header` — não recria a cabeceira. Padroniza o
 * empilhamento `flex flex-col gap-4`, a região do `RecordActionBar` (slot
 * `actionBar`) e o corpo de `RecordSection`s (children). Apresentacional e
 * server-safe (sem hooks).
 */
export function RecordLayout({
  header,
  actionBar,
  children,
  className,
}: {
  header: ReactNode;
  actionBar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {header}
      {actionBar}
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
