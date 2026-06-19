"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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

import {
  eliminarProveedorAction,
  type CuentaContableOption,
  type ProveedorRow,
} from "@/lib/actions/proveedores";
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

import { ProveedorFormDialog, type ProveedorFormState } from "./proveedor-form-dialog";

type Props = {
  proveedores: ProveedorRow[];
  total: number;
  paises: string[];
  q: string;
  pais: string;
  sort: string;
  dir: SortDir;
  page: number;
  perPage: number;
  cuentas: CuentaContableOption[];
  cuentasGasto: CuentaContableOption[];
};

export function ProveedoresTable({
  proveedores,
  total,
  paises,
  q,
  pais,
  cuentas,
  cuentasGasto,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [formState, setFormState] = useState<ProveedorFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProveedorRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const onPaisChange = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "todos") {
      next.delete("pais");
    } else {
      next.set("pais", value);
    }
    next.delete("page");
    const qs = next.toString();
    startNav(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const columns: ColumnDef<ProveedorRow>[] = [
    {
      id: "nombre",
      header: () => <SortableHeader columnId="nombre">Nombre</SortableHeader>,
      meta: { label: "Nombre" },
      cell: ({ row }) => (
        <Link
          href={`/maestros/proveedores/${row.original.id}`}
          className="text-sm font-medium hover:underline"
        >
          {row.original.nombre}
        </Link>
      ),
    },
    {
      id: "cuit",
      header: () => <SortableHeader columnId="cuit">CUIT / ID fiscal</SortableHeader>,
      meta: { label: "CUIT / ID fiscal" },
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">
          {row.original.cuit ?? <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      id: "pais",
      header: () => <SortableHeader columnId="pais">País</SortableHeader>,
      meta: { label: "País" },
      cell: ({ row }) => (
        <Badge variant="outline">
          <span className="font-mono">{row.original.pais}</span>
        </Badge>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      meta: { label: "Estado" },
      cell: ({ row }) => (
        <Badge variant={row.original.estado === "activo" ? "default" : "secondary"}>
          {row.original.estado}
        </Badge>
      ),
    },
    {
      id: "cuenta",
      header: "Cuenta contable",
      meta: { label: "Cuenta contable" },
      cell: ({ row }) =>
        row.original.cuentaContableCodigo ? (
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.cuentaContableCodigo}
            </span>
            <span className="text-sm">{row.original.cuentaContableNombre}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sin vincular</span>
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
    data: proveedores,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startDelete(async () => {
      const result = await eliminarProveedorAction(id);
      if (result.ok) {
        toast.success(
          result.softDeleted
            ? "Proveedor marcado como inactivo (tiene embarques o compras asociados)."
            : "Proveedor eliminado.",
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
        <DataTableSearch paramName="q" initialValue={q} placeholder="Buscar por nombre o CUIT…" />
        <Select value={pais || "todos"} onValueChange={onPaisChange}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los países</SelectItem>
            {paises.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="font-mono">{p}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ColumnsToggle table={table} />
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo proveedor
        </Button>
      </div>

      <DataTable
        table={table}
        emptyMessage="Aún no hay proveedores registrados."
        emptyFilteredMessage="No hay proveedores para los filtros seleccionados."
        isFiltered={total > 0 || q.length > 0 || (pais.length > 0 && pais !== "todos")}
      />

      <ProveedorFormDialog
        state={formState}
        cuentas={cuentas}
        cuentasGasto={cuentasGasto}
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
                <DialogTitle>Eliminar proveedor</DialogTitle>
                <DialogDescription>
                  ¿Confirma eliminar al proveedor{" "}
                  <span className="font-medium text-foreground">{pendingDelete.nombre}</span>? Si
                  tiene embarques o compras asociados se marcará como inactivo en su lugar.
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
