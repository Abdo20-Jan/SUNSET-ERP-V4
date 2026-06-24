import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { listarCuentasContablesParaCliente, obtenerClientePorId } from "@/lib/actions/clientes";
import { listarProvincias } from "@/lib/actions/provincias";
import { CondicionIva, TipoCanal } from "@/generated/prisma/client";
import { RecordHeader } from "@/components/layout/record-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import { ClienteEditWindow } from "./cliente-edit-window";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const TIPO_CANAL_LABEL: Record<TipoCanal, string> = {
  MAYORISTA: "Mayorista / Distribuidor",
  MINORISTA: "Minorista / Punto de Venta",
  REVENDEDOR_GOMERIA: "Revendedor / Gomería",
  TRANSPORTISTA: "Transportista / Flota",
  GRANDE_CUENTA: "Gran Cuenta / Concesionaria",
  EXTERIOR: "Exterior (exportación)",
  CONSUMIDOR_FINAL: "Consumidor Final ocasional",
};

const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  RI: "Responsable Inscripto",
  MONOTRIBUTO: "Monotributista",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
  EXTERIOR: "Exterior (exportación)",
};

function siNo(value: boolean): string {
  return value ? "Sí" : "No";
}

export default async function ClienteDetallePage({ params }: { params: Params }) {
  const { id } = await params;

  const cliente = await obtenerClientePorId(id);
  if (!cliente) notFound();

  const [ventasCount, cuentas, provincias] = await Promise.all([
    db.venta.count({ where: { clienteId: id } }),
    listarCuentasContablesParaCliente(),
    listarProvincias(),
  ]);

  const activo = cliente.estado === "activo";
  const condicionLabel = CONDICION_IVA_LABEL[cliente.condicionIva];
  const subtitle = cliente.cuit ? `${condicionLabel} · CUIT ${cliente.cuit}` : condicionLabel;

  return (
    <RecordLayout
      header={
        <RecordHeader
          breadcrumb={[
            { label: "Maestros", href: "/maestros" },
            { label: "Clientes", href: "/maestros/clientes" },
            { label: cliente.nombre },
          ]}
          title={cliente.nombre}
          subtitle={subtitle}
          status={
            <StatusBadge
              estado={activo ? "ACTIVO" : "INACTIVO"}
              label={activo ? "Activo" : "Inactivo"}
            />
          }
        />
      }
      actionBar={
        <RecordActionBar
          left={
            <Link
              href="/maestros/clientes"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <ClienteEditWindow cliente={cliente} cuentas={cuentas} provincias={provincias} />
        </RecordActionBar>
      }
    >
      <RecordSection title="Datos generales">
        <RecordFieldGrid>
          <RecordField label="Nombre">{cliente.nombre}</RecordField>
          <RecordField label="CUIT">{cliente.cuit ?? "—"}</RecordField>
          <RecordField label="Tipo de canal">{TIPO_CANAL_LABEL[cliente.tipoCanal]}</RecordField>
          <RecordField label="Teléfono">{cliente.telefono ?? "—"}</RecordField>
          <RecordField label="Email">{cliente.email ?? "—"}</RecordField>
          <RecordField label="Dirección">{cliente.direccion ?? "—"}</RecordField>
          <RecordField label="Estado">{activo ? "Activo" : "Inactivo"}</RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection title="Datos fiscales">
        <RecordFieldGrid>
          <RecordField label="Condición IVA">{condicionLabel}</RecordField>
          <RecordField label="Provincia">{cliente.provinciaNombre ?? "—"}</RecordField>
          <RecordField label="Alícuota Percepción IIBB">
            {cliente.alicuotaPercepcionIIBB ?? "Default jurisdicción"}
          </RecordField>
          <RecordField label="Exento Percepción IIBB">
            {siNo(cliente.exentoPercepcionIIBB)}
          </RecordField>
          <RecordField label="Agente retención IVA">{siNo(cliente.agenteRetencionIva)}</RecordField>
          <RecordField label="Agente retención Ganancias">
            {siNo(cliente.agenteRetencionGanancias)}
          </RecordField>
          <RecordField label="Agente recaudación IIBB">{siNo(cliente.agenteIibb)}</RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection title="Cuenta contable">
        <RecordFieldGrid>
          <RecordField label="Cuenta">
            {cliente.cuentaContableCodigo ? (
              <span>
                <span className="font-mono text-xs text-muted-foreground">
                  {cliente.cuentaContableCodigo}
                </span>{" "}
                {cliente.cuentaContableNombre}
              </span>
            ) : (
              "Sin vincular"
            )}
          </RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection title="Referencias" description="Vínculos del cliente (solo lectura).">
        <RecordFieldGrid>
          <RecordField label="Ventas asociadas">{ventasCount}</RecordField>
        </RecordFieldGrid>
      </RecordSection>
    </RecordLayout>
  );
}
