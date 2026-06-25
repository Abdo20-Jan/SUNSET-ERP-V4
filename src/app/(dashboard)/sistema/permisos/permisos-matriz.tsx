"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Download01Icon, MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";

import {
  actualizarPerfilAction,
  copiarPerfilAction,
  crearPerfilAction,
  exportarMatrizAction,
  guardarPermisosPerfilAction,
  type MatrizData,
  type PerfilRow,
  type PermisosActionResult,
  setPerfilActivoAction,
} from "@/lib/actions/permisos-admin";
import type { DimensionGrupo } from "../permisos-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DirtyFooter } from "@/components/record/dirty-footer";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { agruparPorDimension } from "../permisos-labels";

function descargarCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type PerfilFormMode =
  | { kind: "crear" }
  | { kind: "copiar"; source: PerfilRow }
  | { kind: "renombrar"; source: PerfilRow };

export function PermisosMatriz({ data }: { data: MatrizData }) {
  const [editing, setEditing] = useState<PerfilRow | null>(null);
  const [formMode, setFormMode] = useState<PerfilFormMode | null>(null);
  const [isExporting, startExport] = useTransition();

  const grupos = useMemo(() => agruparPorDimension(data.permisos), [data.permisos]);
  const grantSet = useMemo(
    () => new Set(data.grants.map((g) => `${g.perfilId}:${g.permisoId}`)),
    [data.grants],
  );

  const onExport = () => {
    startExport(async () => {
      const res = await exportarMatrizAction();
      if (res.ok) {
        descargarCsv(res.csv, res.filename);
        toast.success("Matriz exportada.");
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onExport} disabled={isExporting}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
          {isExporting ? "Exportando…" : "Exportar matriz"}
        </Button>
        <Button size="sm" onClick={() => setFormMode({ kind: "crear" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo perfil
        </Button>
      </div>

      <MatrizTable
        grupos={grupos}
        perfiles={data.perfiles}
        grantSet={grantSet}
        onEditar={setEditing}
        onCopiar={(p) => setFormMode({ kind: "copiar", source: p })}
        onRenombrar={(p) => setFormMode({ kind: "renombrar", source: p })}
      />

      {editing && (
        <EditarPermisosWindow
          key={editing.id}
          perfil={editing}
          data={data}
          grantSet={grantSet}
          onClose={() => setEditing(null)}
        />
      )}

      {formMode && (
        <PerfilFormWindow
          key={formMode.kind === "crear" ? "crear" : `${formMode.kind}-${formMode.source.id}`}
          mode={formMode}
          onClose={() => setFormMode(null)}
        />
      )}
    </div>
  );
}

function MatrizTable({
  grupos,
  perfiles,
  grantSet,
  onEditar,
  onCopiar,
  onRenombrar,
}: {
  grupos: DimensionGrupo[];
  perfiles: PerfilRow[];
  grantSet: Set<string>;
  onEditar: (p: PerfilRow) => void;
  onCopiar: (p: PerfilRow) => void;
  onRenombrar: (p: PerfilRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-muted/40">
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-10 border-r border-b border-border bg-muted/40 px-3 py-2 text-left font-semibold"
            >
              Perfil
            </th>
            {grupos.map((g) => (
              <th
                key={g.dimension}
                colSpan={g.items.length}
                className="border-r border-b border-border px-2 py-1.5 text-center text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            {grupos.flatMap((g) =>
              g.items.map((p) => (
                <th
                  key={p.id}
                  title={p.descripcion ?? p.clave}
                  className="border-r border-b border-border px-2 py-1.5 text-center font-mono text-[10px] font-normal text-muted-foreground"
                >
                  {p.clave}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {perfiles.map((perfil) => (
            <tr key={perfil.id} className="odd:bg-background even:bg-muted/20">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-b border-border bg-inherit px-3 py-2 text-left font-normal"
              >
                <PerfilRowHeader
                  perfil={perfil}
                  onEditar={() => onEditar(perfil)}
                  onCopiar={() => onCopiar(perfil)}
                  onRenombrar={() => onRenombrar(perfil)}
                />
              </th>
              {grupos.flatMap((g) =>
                g.items.map((p) => {
                  const granted = grantSet.has(`${perfil.id}:${p.id}`);
                  return (
                    <td
                      key={p.id}
                      className={cn(
                        "border-r border-b border-border px-2 py-2 text-center",
                        granted ? "text-success" : "text-muted-foreground/40",
                      )}
                    >
                      {granted ? "✓" : "·"}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerfilRowHeader({
  perfil,
  onEditar,
  onCopiar,
  onRenombrar,
}: {
  perfil: PerfilRow;
  onEditar: () => void;
  onCopiar: () => void;
  onRenombrar: () => void;
}) {
  const router = useRouter();
  const [, startToggle] = useTransition();

  const onToggleActivo = () => {
    startToggle(async () => {
      const res = await setPerfilActivoAction(perfil.id, !perfil.activo);
      if (res.ok) {
        toast.success(perfil.activo ? "Perfil desactivado." : "Perfil activado.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{perfil.nombre}</span>
          {perfil.esSistema && (
            <Badge variant="outline" className="text-[9px]">
              Sistema
            </Badge>
          )}
          {!perfil.activo && (
            <Badge variant="outline" className="text-[9px] text-destructive">
              Inactivo
            </Badge>
          )}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {perfil.codigo} · {perfil.permisosCount} permisos · {perfil.usuariosCount} usuarios
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Acciones del perfil" />}
        >
          <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={perfil.esSistema} onClick={onEditar}>
            Editar permisos
          </DropdownMenuItem>
          <DropdownMenuItem disabled={perfil.esSistema} onClick={onRenombrar}>
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCopiar}>Copiar perfil</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={perfil.esSistema} onClick={onToggleActivo}>
            {perfil.activo ? "Desactivar" : "Activar"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function EditarPermisosWindow({
  perfil,
  data,
  grantSet,
  onClose,
}: {
  perfil: PerfilRow;
  data: MatrizData;
  grantSet: Set<string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const grupos = useMemo(() => agruparPorDimension(data.permisos), [data.permisos]);
  const initial = useMemo(
    () =>
      new Set(data.permisos.filter((p) => grantSet.has(`${perfil.id}:${p.id}`)).map((p) => p.id)),
    [data.permisos, grantSet, perfil.id],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [motivo, setMotivo] = useState("");
  const [isSaving, startSaving] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDirty = !setsEqual(selected, initial);

  const onSave = () => {
    startSaving(async () => {
      const res = await guardarPermisosPerfilAction(perfil.id, {
        permisoIds: [...selected],
        motivo: motivo.trim().length > 0 ? motivo.trim() : undefined,
      });
      if (res.ok) {
        toast.success("Permisos actualizados.");
        onClose();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <FloatingWorkWindow
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Editar permisos · ${perfil.nombre}`}
      description="Tildá las claves que el perfil concede. Agrupadas por dimensión."
      initialWidth={560}
      initialHeight={600}
      footer={
        <DirtyFooter
          isDirty={isDirty}
          isSaving={isSaving}
          onSave={onSave}
          onCancel={onClose}
          saveLabel="Guardar permisos"
        />
      }
    >
      <div className="flex flex-col gap-4">
        {grupos.map((g) => (
          <div key={g.dimension} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {g.label}
            </span>
            <div className="flex flex-col gap-1">
              {g.items.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="font-mono text-xs">{p.clave}</span>
                  {p.descripcion && (
                    <span className="truncate text-xs text-muted-foreground">
                      · {p.descripcion}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Label htmlFor="perm-motivo">Motivo (opcional)</Label>
          <Input
            id="perm-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: ajuste de permisos del área"
          />
        </div>
      </div>
    </FloatingWorkWindow>
  );
}

const MENSAJE_OK: Record<PerfilFormMode["kind"], string> = {
  crear: "Perfil creado.",
  copiar: "Perfil copiado.",
  renombrar: "Perfil actualizado.",
};

function dispatchPerfilForm(
  mode: PerfilFormMode,
  v: { codigo: string; nombre: string; descripcion: string },
): Promise<PermisosActionResult> {
  if (mode.kind === "crear") {
    return crearPerfilAction({ codigo: v.codigo, nombre: v.nombre, descripcion: v.descripcion });
  }
  if (mode.kind === "copiar") {
    return copiarPerfilAction(mode.source.id, { codigo: v.codigo, nombre: v.nombre });
  }
  return actualizarPerfilAction(mode.source.id, { nombre: v.nombre, descripcion: v.descripcion });
}

function PerfilFormWindow({ mode, onClose }: { mode: PerfilFormMode; onClose: () => void }) {
  const router = useRouter();
  const source = mode.kind === "crear" ? null : mode.source;
  const esCopia = mode.kind === "copiar";
  const esRenombrar = mode.kind === "renombrar";

  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState(() => {
    if (esCopia) return `${source?.nombre} (copia)`;
    if (esRenombrar) return source?.nombre ?? "";
    return "";
  });
  const [descripcion, setDescripcion] = useState(esRenombrar ? (source?.descripcion ?? "") : "");
  const [isSaving, startSaving] = useTransition();

  const onSave = () => {
    startSaving(async () => {
      const res = await dispatchPerfilForm(mode, { codigo, nombre, descripcion });
      if (res.ok) {
        toast.success(MENSAJE_OK[mode.kind]);
        onClose();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const isDirty = esRenombrar
    ? nombre.trim().length > 0
    : codigo.trim().length >= 2 && nombre.trim().length > 0;
  const titulo = esRenombrar
    ? `Renombrar · ${source?.nombre}`
    : esCopia
      ? `Copiar perfil · ${source?.nombre}`
      : "Nuevo perfil";

  return (
    <FloatingWorkWindow
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={titulo}
      description={
        esRenombrar
          ? "Cambiá el nombre o la descripción del perfil."
          : esCopia
            ? "Crea un perfil nuevo con los mismos permisos que el de origen."
            : "Crea un perfil vacío. Asigná permisos desde la matriz."
      }
      initialWidth={460}
      initialHeight={esCopia ? 320 : 400}
      footer={
        <DirtyFooter
          isDirty={isDirty}
          isSaving={isSaving}
          onSave={onSave}
          onCancel={onClose}
          saveLabel={MENSAJE_OK[mode.kind].replace(".", "")}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {!esRenombrar && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-codigo">Código *</Label>
            <Input
              id="perfil-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej.: VENDEDOR_SR"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Solo A-Z, 0-9 y _ (se normaliza a mayúsculas).
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="perfil-nombre">Nombre *</Label>
          <Input
            id="perfil-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej.: Vendedor Sénior"
          />
        </div>
        {!esCopia && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-desc">Descripción</Label>
            <Input
              id="perfil-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>
        )}
      </div>
    </FloatingWorkWindow>
  );
}
