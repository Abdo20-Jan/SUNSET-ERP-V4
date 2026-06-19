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

import { CondicionIva } from "@/generated/prisma/client";
import {
  eliminarClienteAction,
  type ClienteRow,
  type CuentaContableOption,
} from "@/lib/actions/clientes";
import type { ProvinciaRow } from "@/lib/actions/provincias";
import type { VistaGuardada } from "@/lib/actions/saved-views";
import type { SortDir } from "@/lib/table-sort";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnsToggle } from "@/components/ui/columns-toggle";
import { DataTable } from "@/components/ui/data-table";
import { DataTableSearch } from "@/components/ui/data-table-search";
import { ExportButton } from "@/components/ui/export-button";
import { SavedViews } from "@/components/ui/saved-views";
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

import { ClienteFormDialog, type ClienteFormState } from "./cliente-form-dialog";

const CONDICION_IVA_SHORT: Record<CondicionIva, string> = {
  RI: "RI",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Cons. Final",
  EXTERIOR: "Exterior",
};

type Props = {
  clientes: ClienteRow[];
  total: number;
  cuentas: CuentaContableOption[];
  provincias: ProvinciaRow[];
  vistas: VistaGuardada[];
  q: string;
  estado: string;
  sort: string;
  dir: SortDir;
  page: number;
  perPage: number;
};

export function ClientesTable({ clientes, total, cuentas, provincias, vistas, q, estado }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [formState, setFormState] = useState<ClienteFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClienteRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const onEstadoChange = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "todos") {
      next.delete("estado");
    } else {
      next.set("estado", value);
    }
    next.delete("page");
    const qs = next.toString();
    startNav(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const columns: ColumnDef<ClienteRow>[] = [
    {
      id: "nombre",
      header: () => <SortableHeader columnId="nombre">Nombre</SortableHeader>,
      meta: { label: "Nombre" },
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.nombre}</span>,
    },
    {
      id: "cuit",
      header: () => <SortableHeader columnId="cuit">CUIT</SortableHeader>,
      meta: { label: "CUIT" },
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">{row.original.cuit ?? "—"}</span>
      ),
    },
    {
      id: "condicionIva",
      header: "Condición IVA",
      meta: { label: "Condición IVA" },
      cell: ({ row }) => (
        <Badge variant="outline">{CONDICION_IVA_SHORT[row.original.condicionIva]}</Badge>
      ),
    },
    {
      id: "telefono",
      header: "Teléfono",
      meta: { label: "Teléfono" },
      cell: ({ row }) => <span className="text-sm">{row.original.telefono ?? "—"}</span>,
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
    data: clientes,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startDelete(async () => {
      const result = await eliminarClienteAction(id);
      if (result.ok) {
        toast.success(
          result.softDeleted
            ? "Cliente marcado como inactivo (tiene ventas asociadas)."
            : "Cliente eliminado.",
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
        <Select value={estado || "todos"} onValueChange={onEstadoChange}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activo">Activos</SelectItem>
            <SelectItem value="inactivo">Inactivos</SelectItem>
          </SelectContent>
        </Select>
        <ColumnsToggle table={table} />
        <SavedViews
          ruta={pathname}
          vistas={vistas}
          columnVisibility={columnVisibility}
          onApplyColumns={setColumnVisibility}
        />
        <ExportButton recurso="clientes" />
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo cliente
        </Button>
      </div>

      <DataTable
        table={table}
        emptyMessage="Aún no hay clientes registrados."
        emptyFilteredMessage="No hay clientes para los filtros seleccionados."
        isFiltered={total > 0 || q.length > 0 || (estado.length > 0 && estado !== "todos")}
      />

      <ClienteFormDialog
        state={formState}
        cuentas={cuentas}
        provincias={provincias}
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
                <DialogTitle>Eliminar cliente</DialogTitle>
                <DialogDescription>
                  ¿Confirma eliminar al cliente{" "}
                  <span className="font-medium text-foreground">{pendingDelete.nombre}</span>? Si
                  tiene ventas asociadas se marcará como inactivo en su lugar.
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
