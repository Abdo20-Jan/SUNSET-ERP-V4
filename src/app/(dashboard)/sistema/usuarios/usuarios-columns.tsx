"use client";

import type { ColumnDef } from "@tanstack/react-table";

import type { Role } from "@/generated/prisma/client";
import type { UsuarioRow } from "@/lib/actions/usuarios";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/data-grid/entity-link";
import { StatusBadge } from "@/components/ui/status-badge";

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Master", USER: "Usuario" };

function fmtFecha(d: Date): string {
  return new Date(d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function buildUsuariosColumns(): ColumnDef<UsuarioRow, unknown>[] {
  return [
    {
      accessorKey: "username",
      header: "Usuario",
      meta: { pinned: "left", width: 200, label: "Usuario" },
      cell: ({ row }) => (
        <EntityLink
          label={row.original.username}
          href={`/sistema/usuarios/${row.original.id}`}
          tabLabel={row.original.nombre}
          menu={[{ label: "Abrir ficha", href: `/sistema/usuarios/${row.original.id}` }]}
        />
      ),
    },
    {
      accessorKey: "nombre",
      header: "Nombre",
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.nombre}</span>,
    },
    {
      accessorKey: "role",
      header: "Rol",
      meta: { label: "Rol" },
      cell: ({ row }) => <Badge variant="outline">{ROLE_LABEL[row.original.role]}</Badge>,
    },
    {
      id: "perfil",
      accessorFn: (r) => r.perfilNombre ?? "—",
      header: "Perfil",
      meta: { label: "Perfil" },
      cell: ({ row }) => <span className="text-sm">{row.original.perfilNombre ?? "—"}</span>,
    },
    {
      accessorKey: "activo",
      header: "Estado",
      meta: { label: "Estado" },
      cell: ({ row }) => (
        <StatusBadge
          estado={row.original.activo ? "ACTIVO" : "INACTIVO"}
          label={row.original.activo ? "Activo" : "Inactivo"}
        />
      ),
    },
    {
      id: "updatedAt",
      accessorFn: (r) => new Date(r.updatedAt).getTime(),
      header: "Última actualización",
      meta: { align: "right", label: "Última actualización" },
      cell: ({ row }) => (
        <span className="block text-right text-xs text-muted-foreground tabular-nums">
          {fmtFecha(row.original.updatedAt)}
        </span>
      ),
    },
  ];
}
