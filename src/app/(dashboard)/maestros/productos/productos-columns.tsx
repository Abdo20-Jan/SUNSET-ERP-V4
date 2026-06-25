"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, Edit02Icon, MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";

import type { ProductoGridRow } from "@/lib/actions/productos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntityLink } from "@/components/data-grid/entity-link";
import { PERMISOS } from "@/lib/permisos-catalog";
import { useHasPermission } from "@/components/auth/permissions-provider";

function formatPrecio(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type ProductoColumnActions = {
  onEdit: (row: ProductoGridRow) => void;
  onDelete: (row: ProductoGridRow) => void;
};

export function buildProductosColumns({
  onEdit,
  onDelete,
}: ProductoColumnActions): ColumnDef<ProductoGridRow, unknown>[] {
  return [
    {
      accessorKey: "codigo",
      header: "Código",
      meta: { pinned: "left", width: 150, label: "Código" },
      cell: ({ row }) => (
        <EntityLink
          label={row.original.codigo}
          onOpen={() => onEdit(row.original)}
          menu={[
            { label: "Editar", onSelect: () => onEdit(row.original) },
            { label: "Abrir en nueva pestaña", disabled: true, hint: "Pronto" },
            { label: "Ver registros relacionados", disabled: true, hint: "Pronto" },
          ]}
        />
      ),
    },
    {
      accessorKey: "nombre",
      header: "Nombre",
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.nombre}</span>,
    },
    {
      accessorKey: "marca",
      header: "Marca",
      cell: ({ row }) => <span className="text-sm">{row.original.marca ?? "—"}</span>,
    },
    {
      accessorKey: "medida",
      header: "Medida",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.medida ?? "—"}</span>,
    },
    {
      accessorKey: "ncm",
      header: "NCM",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.ncm ?? "—"}</span>
      ),
    },
    {
      id: "stock",
      accessorFn: (row) => row.stockActual,
      header: "Stock",
      meta: { align: "right", label: "Stock" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {row.original.stockActual}
          {row.original.stockActual < row.original.stockMinimo && (
            <span className="ml-1 text-xs text-destructive">(bajo)</span>
          )}
        </span>
      ),
    },
    {
      id: "precio",
      accessorFn: (row) => Number(row.precioVenta),
      header: "Precio venta",
      meta: { align: "right", label: "Precio venta" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatPrecio(row.original.precioVenta)}
        </span>
      ),
    },
    {
      accessorKey: "activo",
      header: "Estado",
      meta: { label: "Estado" },
      cell: ({ row }) => (
        <Badge variant={row.original.activo ? "default" : "secondary"}>
          {row.original.activo ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions onEdit={() => onEdit(row.original)} onDelete={() => onDelete(row.original)} />
      ),
    },
  ];
}

export function ProductoExpandedRow({ producto }: { producto: ProductoGridRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-6">
      <DetalleField label="Descripción" value={producto.descripcion ?? "—"} />
      <DetalleField label="Modelo" value={producto.modelo ?? "—"} />
      <DetalleField label="Unidad" value={producto.unidad} />
      <DetalleField label="NCM" value={producto.ncm ?? "—"} />
      <DetalleField label="Stock mínimo" value={String(producto.stockMinimo)} />
      <DetalleField label="DIE %" value={producto.diePorcentaje} />
    </dl>
  );
}

function DetalleField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  // PR-007 (piloto): la acción destructiva exige `admin.acceso`. Con RBAC OFF el hook devuelve
  // true (sin cambios); con RBAC ON sin permiso queda deshabilitada con hint (layout estable).
  // La server action `eliminarProductoAction` no se toca — el backend sigue validando.
  const canDelete = useHasPermission(PERMISOS.ADMIN_ACCESO);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Acciones" />}>
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
          Editar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Eliminar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Eliminar
            <span className="ml-auto pl-3 text-[10px] tracking-wide text-muted-foreground uppercase">
              Sin permiso
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
