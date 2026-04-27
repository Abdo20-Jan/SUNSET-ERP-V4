"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons";

import {
  deleteCotizacionAction,
  upsertCotizacionAction,
} from "@/lib/actions/cotizaciones";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: number;
  fecha: string;
  valor: string;
  fuente: string | null;
};

type FormState =
  | { mode: "create" }
  | { mode: "edit"; row: Row };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtValor(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function CotizacionesTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startDelete(async () => {
      const result = await deleteCotizacionAction(id);
      if (result.ok) {
        toast.success("Cotización eliminada.");
        setPendingDelete(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-sm text-muted-foreground">
          {rows.length} cotización{rows.length === 1 ? "" : "es"} registrada
          {rows.length === 1 ? "" : "s"}.
        </p>
        <Button onClick={() => setFormState({ mode: "create" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Cargar TC del día
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead className="text-right">1 USD = ARS</TableHead>
            <TableHead>Fuente</TableHead>
            <TableHead>
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                Aún no hay cotizaciones cargadas.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.fecha}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {fmtValor(r.valor)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.fuente ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <RowActions
                    onEdit={() => setFormState({ mode: "edit", row: r })}
                    onDelete={() => setPendingDelete(r)}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <CotizacionFormDialog
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
                <DialogTitle>Eliminar cotización</DialogTitle>
                <DialogDescription>
                  ¿Confirma eliminar la cotización del{" "}
                  <span className="font-medium text-foreground">
                    {pendingDelete.fecha}
                  </span>
                  ?
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

function CotizacionFormDialog({
  state,
  onClose,
}: {
  state: FormState | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const open = state !== null;

  const initialFecha =
    state?.mode === "edit" ? state.row.fecha : todayIso();
  const initialValor = state?.mode === "edit" ? state.row.valor : "";
  const initialFuente = state?.mode === "edit" ? (state.row.fuente ?? "") : "";

  const [fecha, setFecha] = useState(initialFecha);
  const [valor, setValor] = useState(initialValor);
  const [fuente, setFuente] = useState(initialFuente);

  // Reset when state changes
  if (open && state) {
    const expectedFecha =
      state.mode === "edit" ? state.row.fecha : todayIso();
    if (fecha === "" && expectedFecha !== "") {
      setFecha(expectedFecha);
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await upsertCotizacionAction({
        fecha,
        valor,
        fuente: fuente.trim() || undefined,
      });
      if (result.ok) {
        toast.success(
          state?.mode === "edit"
            ? "Cotización actualizada."
            : "Cotización guardada.",
        );
        setFecha(todayIso());
        setValor("");
        setFuente("");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isSubmitting) {
          setFecha(todayIso());
          setValor("");
          setFuente("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit"
              ? "Editar cotización"
              : "Cargar TC del día"}
          </DialogTitle>
          <DialogDescription>
            Ingrese cuántos pesos vale 1 USD en esa fecha. Si ya existe una
            cotización para esa fecha, se actualizará.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fecha">Fecha *</Label>
              <Input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={state?.mode === "edit"}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="valor">1 USD = ARS *</Label>
              <Input
                id="valor"
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="1450.50"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="fuente">Fuente (opcional)</Label>
            <Input
              id="fuente"
              type="text"
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
              placeholder="BCRA / Blue / Manual"
              maxLength={40}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
