import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { RecordHeader } from "@/components/layout/record-header";
import { RecordTabs } from "@/components/ui/record-tabs";
import { RelatedItem, RelatedList } from "@/components/ui/related-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveActiveTab } from "@/lib/record-tabs";
import { getHistoricoPagos } from "@/lib/services/historico-pagos";
import { isProveedorExterior } from "@/lib/services/cuentas-a-pagar";

import { PagosHistorialTable } from "../../../tesoreria/pagos-historial/pagos-historial-table";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

const TABS_PROVEEDOR = ["general", "compras", "pagos", "anticipos"] as const;

export const dynamic = "force-dynamic";

function formatMonto(value: number, moneda: string): string {
  return `${moneda} ${value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fechaCorta(d: Date): string {
  return d.toLocaleDateString("es-AR");
}

export default async function ProveedorDetallePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = resolveActiveTab(tab, TABS_PROVEEDOR, "general");

  const proveedor = await db.proveedor.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      cuit: true,
      pais: true,
      tipoProveedor: true,
      email: true,
      telefono: true,
      condicionPagoDefault: true,
      diasPagoDefault: true,
    },
  });

  if (!proveedor) notFound();

  const [comprasCount, anticiposCount] = await Promise.all([
    db.compra.count({ where: { proveedorId: id } }),
    db.anticipoProveedor.count({ where: { proveedorId: id } }),
  ]);
  const esExterior = isProveedorExterior(proveedor);

  return (
    <div className="flex flex-col gap-4">
      <RecordHeader
        breadcrumb={[
          { label: "Proveedores", href: "/maestros/proveedores" },
          { label: proveedor.nombre },
        ]}
        title={proveedor.nombre}
        subtitle={`${proveedor.cuit ?? "Sin CUIT"} · ${proveedor.pais}${esExterior ? " · Exterior" : ""}`}
      />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "general", label: "General" },
          { value: "compras", label: "Compras", count: comprasCount },
          { value: "pagos", label: "Pagos" },
          { value: "anticipos", label: "Anticipos", count: anticiposCount },
        ]}
      />

      {activeTab === "general" && (
        <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tipo">{proveedor.tipoProveedor}</Field>
          <Field label="Email">{proveedor.email ?? "—"}</Field>
          <Field label="Teléfono">{proveedor.telefono ?? "—"}</Field>
          <Field label="Condición pago">
            {proveedor.condicionPagoDefault}
            {proveedor.diasPagoDefault ? ` · ${proveedor.diasPagoDefault} días` : ""}
          </Field>
        </Card>
      )}

      {activeTab === "compras" && <ComprasTab proveedorId={id} />}
      {activeTab === "pagos" && <PagosTab proveedorId={id} />}
      {activeTab === "anticipos" && <AnticiposTab proveedorId={id} />}
    </div>
  );
}

async function ComprasTab({ proveedorId }: { proveedorId: string }) {
  const compras = await db.compra.findMany({
    where: { proveedorId },
    select: { id: true, numero: true, fecha: true, moneda: true, total: true, estado: true },
    orderBy: { fecha: "desc" },
    take: 200,
  });

  return (
    <RelatedList emptyText="Sin compras registradas para este proveedor.">
      {compras.map((c) => (
        <RelatedItem
          key={c.id}
          href={`/compras/${c.id}`}
          title={`#${c.numero}`}
          subtitle={fechaCorta(c.fecha)}
          trailing={
            <>
              <span className="font-mono text-xs tabular-nums">
                {formatMonto(Number(c.total), c.moneda)}
              </span>
              <StatusBadge estado={c.estado} />
            </>
          }
        />
      ))}
    </RelatedList>
  );
}

async function PagosTab({ proveedorId }: { proveedorId: string }) {
  const pagos = await getHistoricoPagos({ proveedorId, limit: 200 });
  const totalArs = pagos.reduce((acc, p) => acc + Number(p.montoArs), 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {pagos.length} pago{pagos.length === 1 ? "" : "s"} · Total{" "}
        <strong>{formatMonto(totalArs, "ARS")}</strong>
      </p>
      <PagosHistorialTable pagos={pagos} />
    </div>
  );
}

async function AnticiposTab({ proveedorId }: { proveedorId: string }) {
  const anticipos = await db.anticipoProveedor.findMany({
    where: { proveedorId },
    select: { id: true, numero: true, fecha: true, montoArs: true, estado: true },
    orderBy: { fecha: "desc" },
  });

  return (
    <RelatedList emptyText="Sin anticipos registrados para este proveedor.">
      {anticipos.map((a) => (
        <RelatedItem
          key={a.id}
          title={`#${a.numero}`}
          subtitle={fechaCorta(a.fecha)}
          trailing={
            <>
              <span className="font-mono text-xs tabular-nums">
                {formatMonto(Number(a.montoArs), "ARS")}
              </span>
              <StatusBadge estado={a.estado} />
            </>
          }
        />
      ))}
    </RelatedList>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
