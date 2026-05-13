import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { getHistoricoPagos } from "@/lib/services/historico-pagos";
import { isProveedorExterior } from "@/lib/services/cuentas-a-pagar";

import { PagosHistorialTable } from "../../../tesoreria/pagos-historial/pagos-historial-table";

type Params = Promise<{ id: string }>;

export default async function ProveedorDetalleePage({ params }: { params: Params }) {
  const { id } = await params;

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

  const pagos = await getHistoricoPagos({ proveedorId: id, limit: 200 });
  const totalArs = pagos.reduce((acc, p) => acc + Number(p.montoArs), 0);
  const esExterior = isProveedorExterior(proveedor);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/maestros/proveedores" className="hover:text-foreground">
              Proveedores
            </Link>
            <span>/</span>
            <span>{proveedor.nombre}</span>
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight">{proveedor.nombre}</h1>
          <p className="text-sm text-muted-foreground">
            {proveedor.cuit ?? "Sin CUIT"} · {proveedor.pais}
            {esExterior ? " · Exterior" : ""}
          </p>
        </div>
      </div>

      <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Tipo">{proveedor.tipoProveedor}</Field>
        <Field label="Email">{proveedor.email ?? "—"}</Field>
        <Field label="Teléfono">{proveedor.telefono ?? "—"}</Field>
        <Field label="Condición pago">
          {proveedor.condicionPagoDefault}
          {proveedor.diasPagoDefault ? ` · ${proveedor.diasPagoDefault} días` : ""}
        </Field>
      </Card>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Histórico de pagos</h2>
          <p className="text-xs text-muted-foreground">
            {pagos.length} pago{pagos.length === 1 ? "" : "s"} · Total ARS{" "}
            <strong>
              {totalArs.toLocaleString("es-AR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </strong>
          </p>
        </div>
        <PagosHistorialTable pagos={pagos} />
      </div>
    </div>
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
