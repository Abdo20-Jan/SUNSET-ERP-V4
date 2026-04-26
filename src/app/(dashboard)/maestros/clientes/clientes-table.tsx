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

import { CondicionIva } from "@/generated/prisma/client";
import {
  eliminarClienteAction,
  type ClienteRow,
  type CuentaContableOption,
} from "@/lib/actions/clientes";
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
  ClienteFormDialog,
  type ClienteFormState,
} from "./cliente-form-dialog";

const CONDICION_IVA_SHORT: Record<CondicionIva, string> = {
  RI: "RI",
  MONOTRIBUTO: "Monotributo",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Cons. Final",
  EXTERIOR: "Exterior",
};

export function ClientesTable({
  clientes,
  cuentas,
}: {
  clientes: ClienteRow[];
  cuentas: CuentaContableOption[];
}) {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<
    "todos" | "activo" | "inactivo"
  >("todos");
  const [formState, setFormState] = useState<ClienteFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClienteRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return clientes.filter((c) => {
      if (estadoFilter !== "todos" && c.estado !== estadoFilter) return false;
      if (!q) return true;
      return (
        c.nombre.toLowerCase().includes(q) ||
        (c.cuit?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [clientes, searchText, estadoFilter]);

  const columns: ColumnDef<ClienteRow>[] = [
    {
      id: "nombre",
      header: "Nombre",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.nombre}</span>
      ),
    },
    {
      id: "cuit",
      header: "CUIT",
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">
          {row.original.cuit ?? "—"}
        </span>
      ),
    },
    {
      id: "condicionIva",
      header: "Condición IVA",
      cell: ({ row }) => (
        <Badge variant="outline">
          {CONDICION_IVA_SHORT[row.original.condicionIva]}
        </Badge>
      ),
    },
    {
      id: "telefono",
      header: "Teléfono",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.telefono ?? "—"}</span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge
          variant={row.original.estado === "activo" ? "default" : "secondary"}
        >
          {row.original.estado}
        </Badge>
      ),
    },
    {
      id: "cuenta",
      header: "Cuenta contable",
      cell: ({ row }) =>
        row.original.cuentaContableCodigo ? (
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.cuentaContableCodigo}
            </span>
            <span className="text-sm">
              {row.original.cuentaContableNombre}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sin vincular</span>
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
        <div className="relative flex-1">
          <HugeiconsIcon
            icon={SearchIcon}
            strokeWidth={2}
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Buscar por nombre o CUIT…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={estadoFilter}
          onValueChange={(v) => {
            if (v === "activo" || v === "inactivo" || v === "todos") {
              setEstadoFilter(v);
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activo">Activos</SelectItem>
            <SelectItem value="inactivo">Inactivos</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo cliente
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
                {clientes.length === 0
                  ? "Aún no hay clientes registrados."
                  : "No hay clientes para los filtros seleccionados."}
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

      <ClienteFormDialog
        state={formState}
        cuentas={cuentas}
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
                  <span className="font-medium text-foreground">
                    {pendingDelete.nombre}
                  </span>
                  ? Si tiene ventas asociadas se marcará como inactivo en su
                  lugar.
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
