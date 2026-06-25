import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { obtenerUsuarioPorId } from "@/lib/actions/usuarios";
import {
  getOverridesUsuario,
  listarCatalogoPermisos,
  listarPerfiles,
} from "@/lib/actions/permisos-admin";
import { PERMISOS, requirePermissionPage } from "@/lib/permisos";
import { RecordHeader } from "@/components/layout/record-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { RecordTabs } from "@/components/ui/record-tabs";
import { AuditTrail } from "@/components/ui/audit-trail";
import { resolveActiveTab } from "@/lib/record-tabs";
import { getAuditLog } from "@/lib/services/auditoria";

import { AdminPageGate } from "../../admin-page-gate";
import { ROLE_LABEL } from "../../permisos-labels";
import { UsuarioEditWindow } from "./usuario-edit-window";
import { UsuarioPermisosTab } from "./usuario-permisos-tab";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

const TABS_USUARIO = ["general", "permisos", "historial"] as const;

function siNo(v: boolean): string {
  return v ? "Sí" : "No";
}

export default async function UsuarioDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requirePermissionPage(PERMISOS.ADMIN_ACCESO);

  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = resolveActiveTab(tab, TABS_USUARIO, "general");

  const usuario = await obtenerUsuarioPorId(id);
  if (!usuario) notFound();

  const [perfiles, catalogo, overrides, historialCount] = await Promise.all([
    listarPerfiles(),
    listarCatalogoPermisos(),
    getOverridesUsuario(id),
    db.auditLog.count({ where: { tabla: "User", registroId: id } }),
  ]);

  return (
    <AdminPageGate>
      <RecordLayout
        header={
          <RecordHeader
            breadcrumb={[
              { label: "Sistema", href: "/sistema" },
              { label: "Usuarios", href: "/sistema/usuarios" },
              { label: usuario.nombre },
            ]}
            title={usuario.nombre}
            subtitle={`@${usuario.username} · ${ROLE_LABEL[usuario.role]}`}
            status={
              <StatusBadge
                estado={usuario.activo ? "ACTIVO" : "INACTIVO"}
                label={usuario.activo ? "Activo" : "Inactivo"}
              />
            }
          />
        }
        actionBar={
          <RecordActionBar
            left={
              <Link
                href="/sistema/usuarios"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Volver
              </Link>
            }
          >
            <UsuarioEditWindow usuario={usuario} perfiles={perfiles} />
          </RecordActionBar>
        }
      >
        <RecordTabs
          activeValue={activeTab}
          tabs={[
            { value: "general", label: "General" },
            { value: "permisos", label: "Permisos", count: overrides.length || undefined },
            { value: "historial", label: "Historial", count: historialCount },
          ]}
        />

        {activeTab === "general" && (
          <RecordSection title="Datos del usuario">
            <RecordFieldGrid>
              <RecordField label="Usuario">{usuario.username}</RecordField>
              <RecordField label="Nombre">{usuario.nombre}</RecordField>
              <RecordField label="Rol">{ROLE_LABEL[usuario.role]}</RecordField>
              <RecordField label="Estado">{usuario.activo ? "Activo" : "Inactivo"}</RecordField>
              <RecordField label="Perfil">{usuario.perfilNombre ?? "Sin perfil"}</RecordField>
              <RecordField label="Moneda preferida">{usuario.monedaPreferida ?? "—"}</RecordField>
              <RecordField label="Modo retroactivo">{siNo(usuario.modoRetroactivo)}</RecordField>
              <RecordField label="Creado">
                {new Date(usuario.createdAt).toLocaleDateString("es-AR")}
              </RecordField>
            </RecordFieldGrid>
          </RecordSection>
        )}

        {activeTab === "permisos" && (
          <UsuarioPermisosTab
            usuario={usuario}
            perfiles={perfiles}
            catalogo={catalogo}
            overrides={overrides}
          />
        )}

        {activeTab === "historial" && <HistorialTab id={id} />}
      </RecordLayout>
    </AdminPageGate>
  );
}

async function HistorialTab({ id }: { id: string }) {
  const entries = await getAuditLog("User", id);
  return <AuditTrail entries={entries} />;
}
