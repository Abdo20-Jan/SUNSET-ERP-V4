"use client";

/**
 * ContactoWindow (CRM-01 · PR-030) — FloatingWorkWindow pequeña para crear /
 * editar un contacto del lead, con el mismo gate de descarte de las demás
 * ventanas (useDirtyState + Dialog). Consume `crearContactoAction` /
 * `editarContactoAction` intactas con el payload
 * `{nombre, cargo?, email?, telefono?, esPrincipal, leadId}`.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { useDirtyState } from "@/components/record/use-dirty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { crearContactoAction, editarContactoAction } from "@/lib/actions/contactos";

/** Proyección serializable del contacto (page server → ilhas client). */
export type ContactoResumen = {
  id: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  esPrincipal: boolean;
};

type Props = {
  leadId: string;
  /** Presente = editar; ausente = nuevo contacto. */
  contacto?: ContactoResumen;
};

function fdStr(fd: FormData, name: string): string {
  const v = fd.get(name);
  if (typeof v === "string") return v;
  return "";
}

function strOrUndefined(v: string): string | undefined {
  if (v.length === 0) return undefined;
  return v;
}

function RequiredMark({ required }: { required?: boolean }) {
  if (!required) return null;
  return <span className="text-red-700"> *</span>;
}

function TextField({
  label,
  name,
  defaultValue,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>
        {label}
        <RequiredMark required={required} />
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="rounded-md border px-3 py-2"
      />
    </label>
  );
}

function ContactoForm({
  contacto,
  pending,
  error,
  onSubmit,
  onCancel,
  onDirty,
}: {
  contacto: ContactoResumen | undefined;
  pending: boolean;
  error: string | null;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  onDirty: () => void;
}) {
  return (
    <form action={onSubmit} onChange={onDirty} className="flex h-full flex-col gap-4 p-1">
      <TextField label="Nombre" name="nombre" defaultValue={contacto?.nombre} required />
      <TextField label="Cargo" name="cargo" defaultValue={contacto?.cargo} />
      <TextField label="Email" name="email" type="email" defaultValue={contacto?.email} />
      <TextField label="Teléfono" name="telefono" defaultValue={contacto?.telefono} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="esPrincipal" defaultChecked={contacto?.esPrincipal ?? false} />
        <span>Contacto principal</span>
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="mt-auto flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}

export function ContactoWindow({ leadId, contacto }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { isDirtyRef } = useDirtyState(dirty);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const esEdicion = contacto !== undefined;

  const requestDiscardConfirm = () =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmOpen(true);
    });

  const resolveConfirm = (ok: boolean) => {
    setConfirmOpen(false);
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolver?.(ok);
  };

  const handleCancel = async () => {
    if (!isDirtyRef.current) {
      setOpen(false);
      return;
    }
    if (await requestDiscardConfirm()) {
      setDirty(false);
      setOpen(false);
    }
  };

  const handleSubmit = (fd: FormData) => {
    const input = {
      nombre: fdStr(fd, "nombre"),
      cargo: strOrUndefined(fdStr(fd, "cargo")),
      email: strOrUndefined(fdStr(fd, "email")),
      telefono: strOrUndefined(fdStr(fd, "telefono")),
      esPrincipal: fd.get("esPrincipal") === "on",
      leadId,
    };
    setError(null);
    start(async () => {
      const r = esEdicion
        ? await editarContactoAction(contacto.id, input)
        : await crearContactoAction(input);
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(esEdicion ? "Contacto actualizado." : "Contacto creado.");
      setDirty(false);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={esEdicion ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        {esEdicion ? "Editar" : "Nuevo contacto"}
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={esEdicion ? `Editar contacto · ${contacto.nombre}` : "Nuevo contacto"}
        description="Persona de contacto asociada a este lead."
        initialWidth={560}
        initialHeight={520}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <ContactoForm
          contacto={contacto}
          pending={pending}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => void handleCancel()}
          onDirty={() => setDirty(true)}
        />
      </FloatingWorkWindow>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) resolveConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar cambios</DialogTitle>
            <DialogDescription>
              Hay cambios sin guardar en el contacto. ¿Desea descartarlos?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolveConfirm(false)}>
              Seguir editando
            </Button>
            <Button type="button" variant="destructive" onClick={() => resolveConfirm(true)}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
