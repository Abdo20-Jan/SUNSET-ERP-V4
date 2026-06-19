"use client";

import { useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Botón "Exportar" para los maestros. Hereda los filtros/sort de la URL actual
// (q, marca/estado/pais, sort, dir) e IGNORA la paginación (page/perPage), de
// modo que el archivo trae TODAS las filas del set filtrado. El trabajo pesado
// vive en /api/export/[recurso] (server: exceljs/csv).
export function ExportButton({ recurso }: { recurso: string }) {
  const searchParams = useSearchParams();

  const href = (formato: "csv" | "xlsx") => {
    const q = new URLSearchParams(searchParams.toString());
    q.set("formato", formato);
    q.delete("page");
    q.delete("perPage");
    return `/api/export/${recurso}?${q}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
        Exportar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={
            <a href={href("csv")} download>
              CSV
            </a>
          }
        />
        <DropdownMenuItem
          render={
            <a href={href("xlsx")} download>
              Excel (XLSX)
            </a>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
