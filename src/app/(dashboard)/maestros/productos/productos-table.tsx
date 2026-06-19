"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons";

import { eliminarProductoAction, type ProductoRow } from "@/lib/actions/productos";
import type { SortDir } from "@/lib/table-sort";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnsToggle } from "@/components/ui/columns-toggle";
import { DataTable } from "@/components/ui/data-table";
import { DataTableSearch } from "@/components/ui/data-table-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableHeader } from "@/components/ui/sortable-header";

import { ProductoFormDialog, type ProductoFormState } from "./producto-form-dialog";

function formatPrecio(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Props = {
  productos: ProductoRow[];
  total: number;
  marcas: string[];
  q: string;
  marca: string;
  sort: string;
  dir: SortDir;
  page: number;
  perPage: number;
};

export function ProductosTable({ productos, total, marcas, q, marca }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [formState, setFormState] = useState<ProductoFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductoRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const onMarcaChange = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "todas") {
      next.delete("marca");
    } else {
      next.set("marca", value);
    }
    next.delete("page");
    const qs = next.toString();
    startNav(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const columns: ColumnDef<ProductoRow>[] = [
    {
      id: "codigo",
      header: () => <SortableHeader columnId="codigo">Código</SortableHeader>,
      meta: { label: "Código" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.codigo}</span>,
    },
    {
      id: "nombre",
      header: () => <SortableHeader columnId="nombre">Nombre</SortableHeader>,
      meta: { label: "Nombre" },
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.nombre}</span>,
    },
    {
      id: "marca",
      header: () => <SortableHeader columnId="marca">Marca</SortableHeader>,
      meta: { label: "Marca" },
      cell: ({ row }) => <span className="text-sm">{row.original.marca ?? "—"}</span>,
    },
    {
      id: "medida",
      header: "Medida",
      meta: { label: "Medida" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.medida ?? "—"}</span>,
    },
    {
      id: "ncm",
      header: "NCM",
      meta: { label: "NCM" },
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.ncm ?? "—"}</span>
      ),
    },
    {
      id: "stock",
      header: () => (
        <SortableHeader columnId="stock" align="right">
          <span className="block text-right">Stock</span>
        </SortableHeader>
      ),
      meta: { label: "Stock" },
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
      header: () => (
        <SortableHeader columnId="precio" align="right">
          <span className="block text-right">Precio venta</span>
        </SortableHeader>
      ),
      meta: { label: "Precio venta" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatPrecio(row.original.precioVenta)}
        </span>
      ),
    },
    {
      id: "estado",
      header: () => <SortableHeader columnId="estado">Estado</SortableHeader>,
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
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions
          onEdit={() => setFormState({ mode: "edit", row: row.original })}
          onDelete={() => setPendingDelete(row.original)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: productos,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startDelete(async () => {
      const result = await eliminarProductoAction(id);
      if (result.ok) {
        toast.success(
          result.softDeleted
            ? "Producto marcado como inactivo (tiene movimientos asociados)."
            : "Producto eliminado.",
        );
        setPendingDelete(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
        <DataTableSearch paramName="q" initialValue={q} placeholder="Buscar por código o nombre…" />
        <Select value={marca || "todas"} onValueChange={onMarcaChange}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las marcas</SelectItem>
            {marcas.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ColumnsToggle table={table} />
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo producto
        </Button>
      </div>

      <DataTable
        table={table}
        emptyMessage="Aún no hay productos registrados."
        emptyFilteredMessage="No hay productos para los filtros seleccionados."
        isFiltered={total > 0 || q.length > 0 || (marca.length > 0 && marca !== "todas")}
      />

      <ProductoFormDialog state={formState} onClose={() => setFormState(null)} />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          {pendingDelete && (
            <>
              <DialogHeader>
                <DialogTitle>Eliminar producto</DialogTitle>
                <DialogDescription>
                  ¿Confirma eliminar el producto{" "}
                  <span className="font-mono text-foreground">{pendingDelete.codigo}</span>
                  {" — "}
                  <span className="font-medium text-foreground">{pendingDelete.nombre}</span>? Si
                  tiene embarques, compras, ventas o movimientos de stock asociados se marcará como
                  inactivo en su lugar.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPendingDelete(null)}
                  disabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button variant="destructive" onClick={onConfirmDelete} disabled={isDeleting}>
                  {isDeleting ? "Eliminando…" : "Eliminar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
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
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
