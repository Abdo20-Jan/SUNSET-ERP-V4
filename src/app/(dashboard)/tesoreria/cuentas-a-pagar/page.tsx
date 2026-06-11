import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney } from "../../reportes/_components/money";
import {
  getCuentasAPagar,
  getCuentasAPagarPorEmbarque,
  getRefuerzosVepPendientes,
  getSaldoCreditoAduana,
  getSaldosExteriorPorProveedor,
  getSaldosPorProveedorConAging,
  getVepEmbarques,
  listarProveedoresParaIntermediario,
  type CxPRow,
} from "@/lib/services/cuentas-a-pagar";
import { listarCuentasBancariasParaVep } from "@/lib/actions/vep-embarque";
import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import { listarVepDespachosPendientes } from "@/lib/actions/vep-despacho";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { isRetencionGananciasEnabled } from "@/lib/features";

import { VepSection } from "./vep-section";
import { VepDespachoSection } from "./vep-despacho-section";
import { EmbarqueBatchPago } from "./embarque-batch-pago";
import { PagoPorFactura } from "./_components/pago-por-factura";
import { ProveedoresExteriorSection } from "./_components/proveedores-exterior-section";

export const dynamic = "force-dynamic";

export default async function CuentasAPagarPage() {
  const [
    data,
    porEmbarque,
    saldosProveedores,
    vepEmbarques,
    vepDespachosPendientes,
    refuerzos,
    cuentasBancariasArs,
    cuentasBancariasMov,
    saldoCreditoAduana,
    intermediarios,
    defaultFecha,
    saldosExterior,
  ] = await Promise.all([
    getCuentasAPagar(),
    getCuentasAPagarPorEmbarque(),
    getSaldosPorProveedorConAging(),
    getVepEmbarques(),
    listarVepDespachosPendientes(),
    getRefuerzosVepPendientes(),
    listarCuentasBancariasParaVep(),
    listarCuentasBancariasParaMovimiento(),
    getSaldoCreditoAduana(),
    listarProveedoresParaIntermediario(),
    getDefaultFecha(),
    getSaldosExteriorPorProveedor(),
  ]);

  // Filtrar 2.1.5.99 de la sección Aduana genérica — el saldo pendiente
  // de refuerzo se gestiona en la sección VEP con flujo dedicado.
  const aduanaSinRefuerzo = data.aduana.filter((r) => r.cuentaCodigo !== "2.1.5.99");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Cuentas a pagar</h1>
        <p className="text-sm text-muted-foreground">
          Saldos acreedores derivados de los asientos contabilizados. Para dar de baja una deuda
          registre un pago en{" "}
          <Link
            href="/tesoreria/movimientos/nuevo?tipo=PAGO"
            className="underline underline-offset-2"
          >
            Tesorería · Nuevo movimiento
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total pendiente</span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            ARS {fmtMoney(data.totalGeneral)}
          </span>
        </CardContent>
      </Card>

      <PagoPorFactura
        proveedores={saldosProveedores}
        cuentasBancarias={cuentasBancariasMov}
        defaultFecha={defaultFecha}
        retencionGananciasEnabled={isRetencionGananciasEnabled()}
      />

      <EmbarqueBatchPago
        rows={porEmbarque}
        cuentasBancarias={cuentasBancariasMov}
        intermediarios={intermediarios}
        defaultFecha={defaultFecha}
      />

      <VepSection
        veps={vepEmbarques}
        refuerzos={refuerzos}
        cuentasBancarias={cuentasBancariasArs}
        saldoCreditoAduana={saldoCreditoAduana.saldo}
        defaultFecha={defaultFecha}
      />

      <VepDespachoSection
        veps={vepDespachosPendientes}
        cuentasBancarias={cuentasBancariasArs}
        saldoCreditoAduana={saldoCreditoAduana.saldo}
        defaultFecha={defaultFecha}
      />

      <Section
        title="Proveedores comerciales"
        subtitle="Saldos pendientes a proveedores locales (cuenta 2.1.1.x). Incluye gastos, compras, gastos fijos y costos de embarque. Pagos se registran en Tesorería."
        rows={data.proveedoresComerciales}
        showProveedores
      />

      <ProveedoresExteriorSection proveedores={saldosExterior} />

      <Section
        title="Aduana / Nacionalización"
        subtitle="Tributos por pagar a Aduana y AFIP por embarques importados (cuenta 2.1.5.x). El pago se hace via VEP arriba — esta tabla muestra el saldo agregado por cuenta."
        rows={aduanaSinRefuerzo}
      />

      <Section
        title="Otros impuestos"
        subtitle="Retenciones y percepciones a depositar (cuenta 2.1.3.x)."
        rows={data.fiscales}
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  showProveedores = false,
}: {
  title: string;
  subtitle: string;
  rows: CxPRow[];
  showProveedores?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            Sin saldos pendientes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Cuenta</TableHead>
              <TableHead>Nombre</TableHead>
              {showProveedores && <TableHead>Proveedores</TableHead>}
              <TableHead className="text-right">Saldo (USD)</TableHead>
              <TableHead className="text-right">Saldo (ARS)</TableHead>
              <TableHead className="w-28 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const proveedoresActivos = r.proveedores.filter((p) => p.estado === "activo");
              const pagarHref = buildPagarHref(r);
              return (
                <TableRow key={r.cuentaId}>
                  <TableCell className="font-mono text-xs">{r.cuentaCodigo}</TableCell>
                  <TableCell>{r.cuentaNombre}</TableCell>
                  {showProveedores && (
                    <TableCell className="text-xs text-muted-foreground">
                      {proveedoresActivos.length === 0
                        ? "—"
                        : proveedoresActivos.length === 1
                          ? proveedoresActivos[0].nombre
                          : `${proveedoresActivos.length} proveedores comparten esta cuenta`}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {r.saldoUsd ? `US$ ${fmtMoney(r.saldoUsd)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(r.saldo)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={pagarHref}
                      className="inline-flex h-8 items-center rounded-full border border-input bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      Pagar
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function buildPagarHref(row: CxPRow): string {
  // Si la cuenta corresponde a un único proveedor activo, lo nombramos en
  // la descripción para dar contexto del pago.
  const proveedoresActivos = row.proveedores.filter((p) => p.estado === "activo");
  const refProveedor =
    proveedoresActivos.length === 1 ? proveedoresActivos[0].nombre : row.cuentaNombre;

  const params = new URLSearchParams({
    tipo: "PAGO",
    cuentaContableId: String(row.cuentaId),
    monto: row.saldo,
    descripcion: `Pago a ${refProveedor} (${row.cuentaCodigo})`,
  });
  return `/tesoreria/movimientos/nuevo?${params.toString()}`;
}
