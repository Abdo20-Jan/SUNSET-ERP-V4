"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import type { UsuarioRow } from "@/lib/actions/usuarios";
import type { PerfilRow } from "@/lib/actions/permisos-admin";
import { Button } from "@/components/ui/button";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { QuickFilter } from "@/components/data-grid/data-grid-helpers";

import { buildUsuariosColumns } from "./usuarios-columns";
import { UsuarioFormDialog } from "./usuario-form-dialog";

export function UsuariosTable({
  usuarios,
  perfiles,
}: {
  usuarios: UsuarioRow[];
  perfiles: PerfilRow[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const columns = useMemo(() => buildUsuariosColumns(), []);

  const perfilOptions = useMemo(() => {
    const s = new Set(usuarios.map((u) => u.perfilNombre).filter((x): x is string => !!x));
    return Array.from(s)
      .sort()
      .map((n) => ({ value: n, label: n }));
  }, [usuarios]);

  const filters: QuickFilter[] = [
    {
      columnId: "role",
      label: "Rol",
      options: [
        { value: "ADMIN", label: "Master" },
        { value: "USER", label: "Usuario" },
      ],
    },
  ];
  if (perfilOptions.length > 0) {
    filters.push({ columnId: "perfil", label: "Perfil", options: perfilOptions });
  }

  return (
    <div className="flex flex-col">
      <EnterpriseDataGrid
        data={usuarios}
        columns={columns}
        getRowId={(u) => u.id}
        quickSearch={{ placeholder: "Buscar por usuario o nombre…", keys: ["username", "nombre"] }}
        filters={filters}
        savedViews={[
          { id: "todos", label: "Todos" },
          { id: "activos", label: "Activos", predicate: (u) => u.activo },
          { id: "inactivos", label: "Inactivos", predicate: (u) => !u.activo },
          { id: "masters", label: "Masters", predicate: (u) => u.role === "ADMIN" },
        ]}
        emptyMessage="Aún no hay usuarios registrados."
        emptyFilteredMessage="No hay usuarios para los filtros seleccionados."
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo usuario
          </Button>
        }
      />

      <UsuarioFormDialog open={createOpen} onOpenChange={setCreateOpen} perfiles={perfiles} />
    </div>
  );
}
