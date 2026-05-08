"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import { actualizarJurisdiccionIIBBAction } from "@/lib/actions/jurisdicciones-iibb";
import type { JurisdiccionIIBBRow } from "@/lib/actions/jurisdicciones-iibb";
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
import { Checkbox } from "@/components/ui/checkbox";
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

function fmtAlicuota(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${n.toFixed(2)}%`;
}

export function JurisdiccionesIIBBTable({ rows }: { rows: JurisdiccionIIBBRow[] }) {
  const [editing, setEditing] = useState<JurisdiccionIIBBRow | null>(null);
  const agentes = rows.filter((r) => r.esAgentePercepcion);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <p className="text-sm text-muted-foreground">
          {rows.length} jurisdicciones · Sunset es agente de percepción en{" "}
          <span className="font-medium text-foreground">
            {agentes.length === 0 ? "ninguna" : agentes.map((a) => a.codigo).join(", ")}
          </span>
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Código</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead className="text-right">Alícuota Percepción</TableHead>
            <TableHead className="text-center">Agente</TableHead>
            <TableHead>
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.codigo}</TableCell>
              <TableCell>{r.nombre}</TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {fmtAlicuota(r.alicuotaPercepcion)}
              </TableCell>
              <TableCell className="text-center">
                {r.esAgentePercepcion ? (
                  <Badge variant="default">Sí</Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Editar"
                  onClick={() => setEditing(r)}
                >
                  <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <EditDialog row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditDialog({
  row,
  onClose,
}: {
  row: JurisdiccionIIBBRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [alicuota, setAlicuota] = useState("");
  const [esAgente, setEsAgente] = useState(false);

  // Reset on row change
  if (row && alicuota === "" && row.alicuotaPercepcion !== "") {
    setAlicuota(row.alicuotaPercepcion);
    setEsAgente(row.esAgentePercepcion);
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) return;
    startSave(async () => {
      const result = await actualizarJurisdiccionIIBBAction({
        id: row.id,
        alicuotaPercepcion: alicuota,
        esAgentePercepcion: esAgente,
      });
      if (result.ok) {
        toast.success("Jurisdicción actualizada.");
        setAlicuota("");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(o) => {
        if (!o && !isSaving) {
          setAlicuota("");
          onClose();
        }
      }}
    >
      <DialogContent>
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>Editar {row.nombre}</DialogTitle>
              <DialogDescription>
                Cambios afectan vendas futuras. Vendas ya emitidas guardan el snapshot de alícuota
                usada en el momento de la emisión.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="alicuota">Alícuota Percepción IIBB (%)</Label>
                <Input
                  id="alicuota"
                  type="text"
                  inputMode="decimal"
                  value={alicuota}
                  onChange={(e) => setAlicuota(e.target.value)}
                  placeholder="3.0000"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Default que se aplica cuando el cliente no tiene override de alícuota.
                </p>
              </div>

              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="es-agente"
                  checked={esAgente}
                  onCheckedChange={(c) => setEsAgente(c === true)}
                />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="es-agente">Agente de percepción</Label>
                  <p className="text-xs text-muted-foreground">
                    Si está apagado, las vendas a clientes de esta jurisdicción no llevan percepción
                    IIBB.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Guardando…" : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
