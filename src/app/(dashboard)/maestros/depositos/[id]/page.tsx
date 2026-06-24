import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { RecordHeader } from "@/components/layout/record-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import { DepositoEditWindow } from "./deposito-edit-window";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const TIPO_LABEL: Record<string, string> = {
  NACIONAL: "Nacional",
  ZONA_PRIMARIA: "Zona Primaria Aduanera",
};

export default async function DepositoDetallePage({ params }: { params: Params }) {
  const { id } = await params;

  const deposito = await db.deposito.findUnique({
    where: { id },
    select: { id: true, nombre: true, direccion: true, activo: true, tipo: true },
  });

  if (!deposito) notFound();

  const [movimientosCount, embarquesCount] = await Promise.all([
    db.movimientoStock.count({ where: { depositoId: id } }),
    db.embarque.count({ where: { depositoDestinoId: id } }),
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
    </RecordLayout>
  );
}
