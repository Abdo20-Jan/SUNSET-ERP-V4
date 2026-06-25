import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
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

import { DepositoEditWindow } from "./deposito-edit-window";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

const TABS_DEPOSITO = ["general", "historial"] as const;

const TIPO_LABEL: Record<string, string> = {
  NACIONAL: "Nacional",
  ZONA_PRIMARIA: "Zona Primaria Aduanera",
};

export default async function DepositoDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = resolveActiveTab(tab, TABS_DEPOSITO, "general");

  const deposito = await db.deposito.findUnique({
    where: { id },
    select: { id: true, nombre: true, direccion: true, activo: true, tipo: true },
  });

  if (!deposito) notFound();

  const [movimientosCount, embarquesCount, historialCount] = await Promise.all([
    db.movimientoStock.count({ where: { depositoId: id } }),
    db.embarque.count({ where: { depositoDestinoId: id } }),
    db.auditLog.count({ where: { tabla: "Deposito", registroId: id } }),
  ]);

  const tipoLabel = TIPO_LABEL[deposito.tipo] ?? deposito.tipo;

  return (
    <RecordLayout
      header={
        <RecordHeader
          breadcrumb={[
            { label: "Maestros", href: "/maestros" },
            { label: "Depósitos", href: "/maestros/depositos" },
            { label: deposito.nombre },
          ]}
          title={deposito.nombre}
          subtitle={tipoLabel}
          status={
            <StatusBadge
              estado={deposito.activo ? "ACTIVO" : "INACTIVO"}
              label={deposito.activo ? "Activo" : "Inactivo"}
            />
          }
        />
      }
      actionBar={
        <RecordActionBar
          left={
            <Link
              href="/maestros/depositos"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <DepositoEditWindow deposito={deposito} />
        </RecordActionBar>
      }
    >
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "general", label: "General" },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      {activeTab === "historial" && <HistorialTab depositoId={id} />}

      {activeTab === "general" && (
        <>
          <RecordSection title="Datos del depósito">
            <RecordFieldGrid>
              <RecordField label="Nombre">{deposito.nombre}</RecordField>
              <RecordField label="Dirección">{deposito.direccion ?? "—"}</RecordField>
              <RecordField label="Tipo">{tipoLabel}</RecordField>
              <RecordField label="Estado">{deposito.activo ? "Activo" : "Inactivo"}</RecordField>
            </RecordFieldGrid>
          </RecordSection>

          <RecordSection title="Referencias" description="Vínculos del depósito (solo lectura).">
            <RecordFieldGrid>
              <RecordField label="Movimientos de stock">{movimientosCount}</RecordField>
              <RecordField label="Embarques (destino)">{embarquesCount}</RecordField>
            </RecordFieldGrid>
          </RecordSection>
        </>
      )}
    </RecordLayout>
  );
}

async function HistorialTab({ depositoId }: { depositoId: string }) {
  const entries = await getAuditLog("Deposito", depositoId);
  return <AuditTrail entries={entries} />;
}
