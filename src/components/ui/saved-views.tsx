"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { VisibilityState } from "@tanstack/react-table";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, FloppyDiskIcon, Layers01Icon, StarIcon } from "@hugeicons/core-free-icons";

import {
  definirPredeterminada,
  eliminarVista,
  guardarVista,
  type VistaGuardada,
} from "@/lib/actions/saved-views";
import { buildViewConfig, hayParamsDeVista, viewConfigToSearchParams } from "@/lib/saved-views";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  ruta: string;
  vistas: VistaGuardada[];
  columnVisibility: VisibilityState;
  onApplyColumns: (columns: VisibilityState) => void;
};

// Menú "Vistas" del toolbar: guarda/aplica/elimina vistas personales de la
// lista (filtros + orden + columnas) y permite marcar una como predeterminada.
// La predeterminada se auto-aplica al abrir la ruta sin filtros en la URL.
export function SavedViews({ ruta, vistas, columnVisibility, onApplyColumns }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [comoPredeterminada, setComoPredeterminada] = useState(false);
  const [pending, startTransition] = useTransition();
  const autoAplicadoRef = useRef(false);

  // Auto-aplicar la vista predeterminada una sola vez, al montar, si la ruta se
  // abrió "limpia" (sin filtros/orden en la URL).
  useEffect(() => {
    if (autoAplicadoRef.current) return;
    autoAplicadoRef.current = true;
    if (hayParamsDeVista(new URLSearchParams(searchParams.toString()))) return;
    const predeterminada = vistas.find((v) => v.esPredeterminada);
    if (!predeterminada) return;
    onApplyColumns(predeterminada.config.columns);
    const qs = viewConfigToSearchParams(predeterminada.config).toString();
    if (qs.length > 0) router.replace(`${ruta}?${qs}`);
    // Sólo al montar: la predeterminada se aplica en la carga inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aplicar = (vista: VistaGuardada) => {
    onApplyColumns(vista.config.columns);
    const qs = viewConfigToSearchParams(vista.config).toString();
    setMenuOpen(false);
    startTransition(() => {
      router.push(qs.length > 0 ? `${ruta}?${qs}` : ruta);
    });
  };

  const onGuardar = () => {
    const config = buildViewConfig(new URLSearchParams(searchParams.toString()), columnVisibility);
    startTransition(async () => {
      const res = await guardarVista({
        ruta,
        nombre,
        config,
        esPredeterminada: comoPredeterminada,
      });
      if (res.ok) {
        toast.success("Vista guardada.");
        setDialogOpen(false);
        setNombre("");
        setComoPredeterminada(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onTogglePredeterminada = (vista: VistaGuardada) => {
    startTransition(async () => {
      const res = await definirPredeterminada(vista.id, !vista.esPredeterminada);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  };

  const onEliminar = (vista: VistaGuardada) => {
    startTransition(async () => {
      const res = await eliminarVista(vista.id);
      if (res.ok) {
        toast.success("Vista eliminada.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} />
          Vistas
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {/* Menu.GroupLabel (DropdownMenuLabel) exige MenuGroupContext: SIEMPRE dentro de un
              DropdownMenuGroup, o base-ui lanza el error al abrir el menú. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Vistas guardadas</DropdownMenuLabel>
          </DropdownMenuGroup>
          {vistas.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Aún no hay vistas guardadas.
            </p>
          ) : (
            vistas.map((vista) => (
              <div key={vista.id} className="flex items-center gap-1 px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => aplicar(vista)}
                  className="flex-1 truncate rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                >
                  {vista.nombre}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    vista.esPredeterminada
                      ? "Quitar como predeterminada"
                      : "Marcar como predeterminada"
                  }
                  aria-pressed={vista.esPredeterminada}
                  disabled={pending}
                  onClick={() => onTogglePredeterminada(vista)}
                >
                  <HugeiconsIcon
                    icon={StarIcon}
                    strokeWidth={2}
                    className={cn(vista.esPredeterminada && "fill-primary text-primary")}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Eliminar vista"
                  disabled={pending}
                  onClick={() => onEliminar(vista)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false);
              setDialogOpen(true);
            }}
          >
            <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />
            Guardar vista actual…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar vista</DialogTitle>
            <DialogDescription>
              Guarda los filtros, el orden y las columnas visibles actuales con un nombre.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saved-view-nombre">Nombre</Label>
              <Input
                id="saved-view-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej.: Bajo stock por marca"
                autoFocus
              />
            </div>
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={comoPredeterminada}
                onCheckedChange={(checked) => setComoPredeterminada(checked === true)}
              />
              Marcar como predeterminada para esta lista
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onGuardar} disabled={pending || nombre.trim().length === 0}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
