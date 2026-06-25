"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { asignarPerfilAction, type UsuarioDetalle } from "@/lib/actions/usuarios";
import {
  type OverrideRow,
  type PermisoCatalogoItem,
  type PerfilRow,
  previewPermisosEfectivosAction,
  quitarOverrideUsuarioAction,
  setOverrideUsuarioAction,
} from "@/lib/actions/permisos-admin";
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
import { DirtyFooter } from "@/components/record/dirty-footer";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { RecordSection } from "@/components/record/record-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { agruparPorDimension, DIMENSION_LABEL } from "../../permisos-labels";

const SIN_PERFIL = "__none__";

type Props = {
  usuario: UsuarioDetalle;
  perfiles: PerfilRow[];
  catalogo: PermisoCatalogoItem[];
  overrides: OverrideRow[];
};

export function UsuarioPermisosTab({ usuario, perfiles, catalogo, overrides }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <PerfilCard usuario={usuario} perfiles={perfiles} />
      <OverridesCard usuario={usuario} catalogo={catalogo} overrides={overrides} />
      <SimularCard usuario={usuario} catalogo={catalogo} />
    </div>
  );
}

// ============================================================
// Perfil de acceso
// ============================================================

function PerfilCard({ usuario, perfiles }: { usuario: UsuarioDetalle; perfiles: PerfilRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perfilId, setPerfilId] = useState(usuario.perfilId ?? SIN_PERFIL);
  const [motivo, setMotivo] = useState("");
  const [isSaving, startSaving] = useTransition();

  const onSave = () => {
    startSaving(async () => {
      const res = await asignarPerfilAction(usuario.id, {
        perfilId: perfilId === SIN_PERFIL ? undefined : perfilId,
        motivo: motivo.trim().length > 0 ? motivo.trim() : undefined,
      });
      if (res.ok) {
        toast.success("Perfil asignado.");
        setOpen(false);
        setMotivo("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <RecordSection
      title="Perfil de acceso"
      description="Plantilla de permisos del usuario. Master (role) tiene acceso total."
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Cambiar perfil
        </Button>
      }
    >
      <p className="text-sm">
        {usuario.perfilNombre ? (
          <span className="font-medium">{usuario.perfilNombre}</span>
        ) : (
          <span className="text-muted-foreground">Sin perfil asignado (cae al rol legacy)</span>
        )}
      </p>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title="Cambiar perfil de acceso"
        initialWidth={460}
        initialHeight={340}
        footer={
          <DirtyFooter
            isDirty={perfilId !== (usuario.perfilId ?? SIN_PERFIL)}
            isSaving={isSaving}
            onSave={onSave}
            onCancel={() => setOpen(false)}
            saveLabel="Asignar perfil"
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Perfil</Label>
            <Select value={perfilId} onValueChange={(v) => setPerfilId(v ?? SIN_PERFIL)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_PERFIL}>— Sin perfil —</SelectItem>
                {perfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="perfil-motivo">Motivo (opcional)</Label>
            <Input
              id="perfil-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: rotación de área"
            />
          </div>
        </div>
      </FloatingWorkWindow>
    </RecordSection>
  );
}

// ============================================================
// Overrides individuales
// ============================================================

function OverridesCard({
  usuario,
  catalogo,
  overrides,
}: {
  usuario: UsuarioDetalle;
  catalogo: PermisoCatalogoItem[];
  overrides: OverrideRow[];
}) {
  const [editing, setEditing] = useState<OverrideRow | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);

  const abrirNuevo = () => {
    setEditing(null);
    setWindowOpen(true);
  };
  const abrirEdicion = (o: OverrideRow) => {
    setEditing(o);
    setWindowOpen(true);
  };

  return (
    <RecordSection
      title="Permisos individuales (overrides)"
      description="Conceder o revocar claves puntuales sobre lo que da el perfil. Con ámbito y expiración opcionales."
      actions={
        <Button size="sm" variant="outline" onClick={abrirNuevo}>
          Agregar override
        </Button>
      }
    >
      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin overrides. El usuario hereda solo su perfil.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {overrides.map((o) => (
            <OverrideRowItem
              key={o.permisoId}
              userId={usuario.id}
              override={o}
              onEdit={() => abrirEdicion(o)}
            />
          ))}
        </div>
      )}

      <OverrideWindow
        userId={usuario.id}
        catalogo={catalogo}
        editing={editing}
        open={windowOpen}
        onOpenChange={setWindowOpen}
      />
    </RecordSection>
  );
}

function OverrideRowItem({
  userId,
  override,
  onEdit,
}: {
  userId: string;
  override: OverrideRow;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [isSaving, startSaving] = useTransition();

  const onQuitar = () => {
    startSaving(async () => {
      const res = await quitarOverrideUsuarioAction(userId, {
        permisoId: override.permisoId,
        motivo: motivo.trim(),
      });
      if (res.ok) {
        toast.success("Override quitado.");
        setConfirmOpen(false);
        setMotivo("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs">{override.clave}</span>
          <Badge
            variant="outline"
            className={override.concedido ? "text-success" : "text-destructive"}
          >
            {override.concedido ? "Concede" : "Revoca"}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {DIMENSION_LABEL[override.dimension]}
          {override.ambito != null ? " · con ámbito" : ""}
          {override.expiraEn
            ? ` · expira ${new Date(override.expiraEn).toLocaleDateString("es-AR")}`
            : " · permanente"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Editar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)}>
          Quitar
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitar override</DialogTitle>
            <DialogDescription>
              Se quitará el override <span className="font-mono">{override.clave}</span>. Indicá un
              motivo (auditado).
            </DialogDescription>
          </DialogHeader>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obligatorio)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isSaving || motivo.trim().length === 0}
              onClick={onQuitar}
            >
              Quitar override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OverrideWindow({
  userId,
  catalogo,
  editing,
  open,
  onOpenChange,
}: {
  userId: string;
  catalogo: PermisoCatalogoItem[];
  editing: OverrideRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [permisoId, setPermisoId] = useState(editing?.permisoId ?? "");
  const [concedido, setConcedido] = useState(editing ? String(editing.concedido) : "true");
  const [ambito, setAmbito] = useState(
    editing?.ambito != null ? JSON.stringify(editing.ambito) : "",
  );
  const [expira, setExpira] = useState(
    editing?.expiraEn ? new Date(editing.expiraEn).toISOString().slice(0, 10) : "",
  );
  const [motivo, setMotivo] = useState("");
  const [isSaving, startSaving] = useTransition();

  // Re-sincroniza al abrir/editar (key-less): el FWW se monta una vez por sesión.
  const resetForm = () => {
    setPermisoId(editing?.permisoId ?? "");
    setConcedido(editing ? String(editing.concedido) : "true");
    setAmbito(editing?.ambito != null ? JSON.stringify(editing.ambito) : "");
    setExpira(editing?.expiraEn ? new Date(editing.expiraEn).toISOString().slice(0, 10) : "");
    setMotivo("");
  };

  const onSave = () => {
    startSaving(async () => {
      const res = await setOverrideUsuarioAction(userId, {
        permisoId,
        concedido: concedido === "true",
        ambito: ambito.trim().length > 0 ? ambito.trim() : undefined,
        expiraEn: expira.length > 0 ? expira : undefined,
        motivo: motivo.trim(),
      });
      if (res.ok) {
        toast.success("Override guardado.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const canSave = permisoId.length > 0 && motivo.trim().length > 0;

  return (
    <FloatingWorkWindow
      open={open}
      onOpenChange={(o) => {
        if (o) resetForm();
        onOpenChange(o);
      }}
      title={editing ? `Editar override · ${editing.clave}` : "Agregar override"}
      description="Concede o revoca una clave puntual. El motor ignora overrides vencidos."
      initialWidth={520}
      initialHeight={520}
      footer={
        <DirtyFooter
          isDirty={canSave}
          isSaving={isSaving}
          onSave={onSave}
          onCancel={() => onOpenChange(false)}
          saveLabel="Guardar override"
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Permiso (clave)</Label>
          <Select
            value={permisoId}
            onValueChange={(v) => setPermisoId(v ?? "")}
            disabled={!!editing}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Seleccioná una clave…" />
            </SelectTrigger>
            <SelectContent>
              {catalogo.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.clave} · {DIMENSION_LABEL[p.dimension]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Tipo</Label>
          <Select value={concedido} onValueChange={(v) => setConcedido(v ?? "true")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Conceder (grant extra)</SelectItem>
              <SelectItem value="false">Revocar (quita lo del perfil)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ambito">Ámbito de datos (JSON, opcional)</Label>
          <textarea
            id="ambito"
            value={ambito}
            onChange={(e) => setAmbito(e.target.value)}
            rows={3}
            placeholder='Ej.: {"depositos":["NACIONAL"]}'
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Escopo por-usuario (carteira/depósitos/empresa). El motor lo reserva para evaluación
            futura.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="expira">Expira el (opcional)</Label>
          <Input
            id="expira"
            type="date"
            value={expira}
            onChange={(e) => setExpira(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ov-motivo">Motivo (obligatorio)</Label>
          <Input
            id="ov-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: acceso temporal a BI por proyecto"
          />
        </div>
      </div>
    </FloatingWorkWindow>
  );
}

// ============================================================
// Simular (preview read-only)
// ============================================================

function SimularCard({
  usuario,
  catalogo,
}: {
  usuario: UsuarioDetalle;
  catalogo: PermisoCatalogoItem[];
}) {
  const [claves, setClaves] = useState<string[] | null>(null);
  const [esAdminTotal, setEsAdminTotal] = useState(false);
  const [isLoading, startLoading] = useTransition();

  const claveToDim = useMemo(() => new Map(catalogo.map((p) => [p.clave, p])), [catalogo]);
  const grupos = useMemo(() => {
    if (!claves) return [];
    const items = claves.map((c) => claveToDim.get(c)).filter((p): p is PermisoCatalogoItem => !!p);
    return agruparPorDimension(items);
  }, [claves, claveToDim]);

  const onSimular = () => {
    startLoading(async () => {
      const res = await previewPermisosEfectivosAction(usuario.id);
      if (res.ok) {
        setClaves(res.claves);
        setEsAdminTotal(res.esAdminTotal);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <RecordSection
      title="Simular permisos efectivos"
      description="Vista de solo lectura de lo que el usuario podría ver/hacer con RBAC (perfil + overrides, sin vencidos). No es login-as."
      actions={
        <Button size="sm" variant="outline" onClick={onSimular} disabled={isLoading}>
          {isLoading ? "Calculando…" : "Simular"}
        </Button>
      }
    >
      {claves === null ? (
        <p className="text-sm text-muted-foreground">
          Ejecutá la simulación para ver el set efectivo de claves.
        </p>
      ) : esAdminTotal ? (
        <p className="text-sm">
          <Badge variant="outline" className="text-success">
            Master
          </Badge>{" "}
          Acceso total a todas las claves (fast-path).
        </p>
      ) : grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin permisos efectivos.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grupos.map((g) => (
            <div key={g.dimension} className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {g.label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((p) => (
                  <Badge key={p.id} variant="outline" className="font-mono text-[11px]">
                    {p.clave}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </RecordSection>
  );
}
