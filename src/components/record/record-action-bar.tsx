import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * RecordActionBar (PR-004) — barra de ações sticky a nível de registro (record),
 * com slots `left` (contexto/voltar) e `right` (ações primárias). Apresentacional
 * e server-safe; os botões interativos entram como `children` (ex.: um botão
 * client "Editar" que abre a FloatingWorkWindow). Densidade/cor seguem os tokens
 * do PR-001. Fica grudada no topo do scroll da ficha (`sticky top-0`).
 */
export function RecordActionBar({
  left,
  right,
  children,
  sticky = true,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 supports-backdrop-filter:backdrop-blur-sm",
        sticky && "sticky top-0 z-10",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{left}</div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {right}
      </div>
    </div>
  );
}
