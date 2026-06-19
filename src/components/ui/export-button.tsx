"use client";

import { useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";

import { buttonVariants } from "@/components/ui/button";

// Botón "Exportar CSV" para los maestros. Hereda los filtros/sort de la URL
// actual (q, marca/estado/pais, sort, dir) e IGNORA la paginación
// (page/perPage), de modo que el archivo trae TODAS las filas del set filtrado.
// El CSV (con BOM) lo genera /api/export/[recurso] y Excel lo abre directo.
export function ExportButton({ recurso }: { recurso: string }) {
  const searchParams = useSearchParams();
  const q = new URLSearchParams(searchParams.toString());
  q.delete("page");
  q.delete("perPage");
  const href = `/api/export/${recurso}?${q}`;

  return (
    <a href={href} download className={buttonVariants({ variant: "outline", size: "sm" })}>
      <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
      Exportar CSV
    </a>
  );
}
