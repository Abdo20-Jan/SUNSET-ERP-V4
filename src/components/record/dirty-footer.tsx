"use client";

import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useInternalTabsOptional } from "@/components/layout/internal-tabs";

/*
 * DirtyFooter (PR-004) — rodapé apresentacional de uma janela/forma de edição:
 * indicador "cambios sin guardar" + botões Cancelar/Guardar. NÃO conhece form
 * algum: o consumidor é dono do `isDirty` (no piloto, `react-hook-form
 * formState.isDirty`) e das ações `onSave`/`onCancel`. Entra no slot `footer` da
 * FloatingWorkWindow.
 *
 * Integração OPT-IN de abas internas (PR-002): se `tabHref` for passado, marca a
 * aba do registro como `dirty` enquanto há mudanças não salvas, via
 * `useInternalTabsOptional()` — degrada a `null` sem provider (TOP_NAV_ENABLED
 * OFF), sem acoplar a FloatingWorkWindow às abas. Limpa o flag no unmount.
 */
export type DirtyFooterProps = {
  isDirty: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  dirtyMessage?: string;
  cleanMessage?: string;
  tabHref?: string;
  tabLabel?: string;
  className?: string;
};

export function DirtyFooter({
  isDirty,
  isSaving = false,
  onSave,
  onCancel,
  saveLabel = "Guardar cambios",
  cancelLabel = "Cancelar",
  dirtyMessage = "Cambios sin guardar",
  cleanMessage = "Sin cambios",
  tabHref,
  tabLabel,
  className,
}: DirtyFooterProps) {
  const tabs = useInternalTabsOptional();

  useEffect(() => {
    if (!tabs || !tabHref) return;
    const label = tabLabel ?? tabHref;
    tabs.openTab({ href: tabHref, label, dirty: isDirty });
    return () => {
      tabs.openTab({ href: tabHref, label, dirty: false });
    };
  }, [tabs, tabHref, tabLabel, isDirty]);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5",
        className,
      )}
    >
      <span className={cn("text-xs", isDirty ? "text-warning" : "text-muted-foreground")}>
        {isDirty ? dirtyMessage : cleanMessage}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          {cancelLabel}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Guardando…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
