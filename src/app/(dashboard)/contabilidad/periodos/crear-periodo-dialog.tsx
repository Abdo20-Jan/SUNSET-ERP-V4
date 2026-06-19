"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { crearPeriodo } from "@/lib/actions/periodos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { esCrearPeriodoValido } from "./cierre-helpers";

export function CrearPeriodoDialog() {
  const [open, setOpen] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [isSubmitting, startTransition] = useTransition();

  const valido = esCrearPeriodoValido(codigo, nombre, fechaInicio, fechaFin);

  const reset = () => {
    setCodigo("");
    setNombre("");
    setFechaInicio("");
    setFechaFin("");
  };

  const onConfirm = () => {
    if (!valido) return;
    startTransition(async () => {
      const result = await crearPeriodo({ codigo, nombre, fechaInicio, fechaFin });
      if (result.ok) {
        toast.success(`Período ${result.codigo} creado.`);
        reset();
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        Nuevo período
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (isSubmitting) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo período contable</DialogTitle>
            <DialogDescription>
              El rango no puede superponerse con otro período. Nace ABIERTO. Sin períodos no se
              pueden registrar asientos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-codigo">Código</Label>
                <Input
                  id="periodo-codigo"
                  placeholder="2025 o 2025-01"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-nombre">Nombre</Label>
                <Input
                  id="periodo-nombre"
                  placeholder="Ejercicio 2025"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-inicio">Inicio</Label>
                <Input
                  id="periodo-inicio"
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-fin">Fin</Label>
                <Input
                  id="periodo-fin"
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {fechaInicio && fechaFin && fechaInicio > fechaFin ? (
              <p className="text-xs text-destructive">La fecha de inicio debe ser ≤ la de fin.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button onClick={onConfirm} disabled={isSubmitting || !valido}>
              {isSubmitting ? "Creando…" : "Crear período"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
