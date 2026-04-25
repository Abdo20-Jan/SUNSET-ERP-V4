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
  eliminarDepositoAction,
  type DepositoRow,
} from "@/lib/actions/depositos";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  DepositoFormDialog,
  type DepositoFormState,
} from "./deposito-form-dialog";

export function DepositosTable({ depositos }: { depositos: DepositoRow[] }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [formState, setFormState] = useState<DepositoFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DepositoRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return depositos;
    return depositos.filter(
      (d) =>
        d.nombre.toLowerCase().includes(q) ||
        (d.direccion?.toLowerCase().includes(q) ?? false),
    );
  }, [depositos, searchText]);

  const columns: ColumnDef<DepositoRow>[] = [
    {
      id: "nombre",
      header: "Nombre",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.nombre}</span>
      ),
    },
    {
      id: "direccion",
      header: "Dirección",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.direccion ?? "—"}</span>
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
      const result = await eliminarDepositoAction(id);
      if (result.ok) {
        toast.success(
          result.softDeleted
            ? "Depósito marcado como inactivo (tiene movimientos o embarques asociados)."
            : "Depósito eliminado.",
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
            placeholder="Buscar por nombre o dirección…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo depósito
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
                {depositos.length === 0
                  ? "Aún no hay depósitos registrados."
                  : "No hay depósitos para la búsqueda."}
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

      <DepositoFormDialog
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
                <DialogTitle>Eliminar depósito</DialogTitle>
                <DialogDescription>
                  ¿Confirma eliminar el depósito{" "}
                  <span className="font-medium text-foreground">
                    {pendingDelete.nombre}
                  </span>
                  ? Si tiene movimientos de stock o embarques asociados se
                  marcará como inactivo en su lugar.
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
