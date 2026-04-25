"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalCircle01Icon,
  SearchIcon,
} from "@hugeicons/core-free-icons";

import {
  eliminarProductoAction,
  type ProductoRow,
} from "@/lib/actions/productos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  ProductoFormDialog,
  type ProductoFormState,
} from "./producto-form-dialog";

function formatPrecio(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ProductosTable({ productos }: { productos: ProductoRow[] }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [marcaFilter, setMarcaFilter] = useState<string>("todas");
  const [formState, setFormState] = useState<ProductoFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductoRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const marcaOptions = useMemo(() => {
    const s = new Set(
      productos
        .map((p) => p.marca)
        .filter((m): m is string => !!m && m.length > 0),
    );
    return Array.from(s).sort();
  }, [productos]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return productos.filter((p) => {
      if (marcaFilter !== "todas" && p.marca !== marcaFilter) return false;
      if (!q) return true;
      return (
        p.codigo.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q)
      );
    });
  }, [productos, searchText, marcaFilter]);

  const columns: ColumnDef<ProductoRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.codigo}</span>
      ),
    },
    {
      id: "nombre",
      header: "Nombre",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.nombre}</span>
      ),
    },
    {
      id: "marca",
      header: "Marca",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.marca ?? "—"}</span>
      ),
    },
    {
      id: "medida",
      header: "Medida",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.medida ?? "—"}
        </span>
      ),
    },
    {
      id: "ncm",
      header: "NCM",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ncm ?? "—"}
        </span>
      ),
    },
    {
      id: "stock",
      header: () => <span className="block text-right">Stock</span>,
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
      header: () => <span className="block text-right">Precio venta</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatPrecio(row.original.precioVenta)}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={row.original.activo ? "default" : "secondary"}>
          {row.original.activo ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <RowActions
          onEdit={() => setFormState({ mode: "edit", row: row.original })}
          onDelete={() => setPendingDelete(row.original)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
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
        <div className="relative flex-1">
          <HugeiconsIcon
            icon={SearchIcon}
            strokeWidth={2}
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Buscar por código o nombre…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={marcaFilter}
          onValueChange={(v) => setMarcaFilter(v ?? "todas")}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las marcas</SelectItem>
            {marcaOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo producto
        </Button>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {productos.length === 0
                  ? "Aún no hay productos registrados."
                  : "No hay productos para los filtros seleccionados."}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <ProductoFormDialog
        state={formState}
        onClose={() => setFormState(null)}
      />

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
                  <span className="font-mono text-foreground">
                    {pendingDelete.codigo}
                  </span>
                  {" — "}
                  <span className="font-medium text-foreground">
                    {pendingDelete.nombre}
                  </span>
                  ? Si tiene embarques, compras, ventas o movimientos de stock
                  asociados se marcará como inactivo en su lugar.
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
                <Button
                  variant="destructive"
                  onClick={onConfirmDelete}
                  disabled={isDeleting}
                >
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

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Acciones" />
        }
      >
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
