"use client";

/**
 * Pestaña Contactos del record de lead (CRM-01 · PR-030). Client-island:
 * lista + acciones por contacto (editar en ContactoWindow, marcar principal,
 * eliminar con confirmación). Consume las actions de `contactos.ts` INTACTAS
 * (`marcarPrincipalAction(id)` / `eliminarContactoAction(id)`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { RecordSection } from "@/components/record/record-section";
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
import { eliminarContactoAction, marcarPrincipalAction } from "@/lib/actions/contactos";

import { ContactoWindow, type ContactoResumen } from "./contacto-window";

function contactoLineas(c: ContactoResumen): string {
  return [c.email, c.telefono].filter(Boolean).join(" · ") || "—";
}

function ContactoItem({
  leadId,
  contacto,
  pending,
  onMarcarPrincipal,
  onEliminar,
}: {
  leadId: string;
  contacto: ContactoResumen;
  pending: boolean;
  onMarcarPrincipal: (id: string) => void;
  onEliminar: (contacto: ContactoResumen) => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {contacto.nombre}
          {contacto.esPrincipal && <Badge variant="outline">Principal</Badge>}
        </div>
        {contacto.cargo && <div className="text-muted-foreground">{contacto.cargo}</div>}
        <div className="text-muted-foreground">{contactoLineas(contacto)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ContactoWindow leadId={leadId} contacto={contacto} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || contacto.esPrincipal}
          onClick={() => onMarcarPrincipal(contacto.id)}
        >
          Marcar principal
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => onEliminar(contacto)}
        >
          Eliminar
        </Button>
      </div>
    </li>
  );
}

function EliminarContactoDialog({
  contacto,
  pending,
  onConfirm,
  onCancel,
}: {
  contacto: ContactoResumen | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={contacto !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar contacto</DialogTitle>
          <DialogDescription>
            {contacto ? `¿Eliminar el contacto «${contacto.nombre}»?` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadContactosTab({
  leadId,
  contactos,
}: {
  leadId: string;
  contactos: ContactoResumen[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aEliminar, setAEliminar] = useState<ContactoResumen | null>(null);

  const marcarPrincipal = (id: string) => {
    start(async () => {
      const r = await marcarPrincipalAction(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Contacto marcado como principal.");
      router.refresh();
    });
  };

  const eliminar = () => {
    if (!aEliminar) return;
    start(async () => {
      const r = await eliminarContactoAction(aEliminar.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Contacto eliminado.");
      setAEliminar(null);
      router.refresh();
    });
  };

  return (
    <RecordSection title="Contactos" actions={<ContactoWindow leadId={leadId} />}>
      {contactos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin contactos.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contactos.map((c) => (
            <ContactoItem
              key={c.id}
              leadId={leadId}
              contacto={c}
              pending={pending}
              onMarcarPrincipal={marcarPrincipal}
              onEliminar={setAEliminar}
            />
          ))}
        </ul>
      )}

      <EliminarContactoDialog
        contacto={aEliminar}
        pending={pending}
        onConfirm={eliminar}
        onCancel={() => setAEliminar(null)}
      />
    </RecordSection>
  );
}
