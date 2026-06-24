"use client";

/**
 * Resumo de seleção (PR-003) — faixa inferior **sticky** com a contagem de
 * linhas selecionadas, um slot de resumo (ex.: somatórios) e um menu de
 * "Acción en masa". Oculta quando nada está selecionado.
 */

import type * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SelectionSummaryFooter({
  count,
  summary,
  bulkActions,
  onClear,
}: {
  count: number;
  summary?: React.ReactNode;
  /** Itens do menu de ação em massa (ex.: `<DropdownMenuItem>…`). */
  bulkActions?: React.ReactNode;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 z-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/80 px-3 py-2 text-sm backdrop-blur">
      <span className="font-medium">
        {count} seleccionado{count === 1 ? "" : "s"}
      </span>
      {summary ? <span className="text-muted-foreground">{summary}</span> : null}
      <div className="ml-auto flex items-center gap-2">
        {bulkActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              Acción en masa
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {bulkActions}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          Limpiar
        </Button>
      </div>
    </div>
  );
}
