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
  getVepEmbarques,
  type CuentaAPagarPorEmbarque,
  type CxPRow,
} from "@/lib/services/cuentas-a-pagar";
import { listarCuentasBancariasParaVep } from "@/lib/actions/vep-embarque";

import { VepSection } from "./vep-section";

export const dynamic = "force-dynamic";

export default async function CuentasAPagarPage() {
  const [data, porEmbarque, vepEmbarques, cuentasBancariasArs] =
    await Promise.all([
      getCuentasAPagar(),
      getCuentasAPagarPorEmbarque(),
      getVepEmbarques(),
      listarCuentasBancariasParaVep(),
    ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Cuentas a pagar
        </h1>
        <p className="text-sm text-muted-foreground">
          Saldos acreedores derivados de los asientos contabilizados. Para
          dar de baja una deuda registre un pago en{" "}
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

      <Section
        title="Proveedores comerciales"
        subtitle="Deuda con proveedores de mercadería y servicios logísticos (cuenta 2.1.1.x)."
        rows={data.proveedoresComerciales}
        showProveedores
      />

      <VepSection veps={vepEmbarques} cuentasBancarias={cuentasBancariasArs} />

      <Section
        title="Aduana / Nacionalización"
        subtitle="Tributos por pagar a Aduana y AFIP por embarques importados (cuenta 2.1.5.x). El pago se hace via VEP arriba — esta tabla muestra el saldo agregado por cuenta."
        rows={data.aduana}
      />

      <Section
        title="Otros impuestos"
        subtitle="Retenciones y percepciones a depositar (cuenta 2.1.3.x)."
        rows={data.fiscales}
      />

      <EmbarqueSection rows={porEmbarque} />
    </div>
  );
}

function EmbarqueSection({ rows }: { rows: CuentaAPagarPorEmbarque[] }) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Por embarque</h2>
          <p className="text-xs text-muted-foreground">
            Costos de nacionalización agrupados por embarque + proveedor —
            pagá todas las facturas de un proveedor en un único movimiento
            contable. La descripción del pago listará el embarque y las
            facturas incluidas.
          </p>
        </div>
        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
          <strong>¿Ya pagaste y la línea sigue acá?</strong> Verificá que el
          asiento del pago haya usado la <strong>cuenta del proveedor</strong>{" "}
          (2.1.x) como contrapartida. Si elegiste una cuenta de gasto (5.x.x.x)
          el saldo del proveedor no se reduce. La columna "Saldo proveedor"
          muestra la deuda viva real.
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Embarque</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Facturas</TableHead>
              <TableHead className="text-right">Total facturado</TableHead>
              <TableHead className="text-right">Saldo proveedor</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
              <TableHead className="w-28 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const numerosFacturas = r.facturas
                .map((f) => f.numero)
                .join(", ")
                .slice(0, 200);
              const href = r.proveedorCuentaContableId
                ? `/tesoreria/movimientos/nuevo?${new URLSearchParams({
                    tipo: "PAGO",
                    cuentaContableId: String(r.proveedorCuentaContableId),
                    monto: r.pendienteArs,
                    descripcion: `Pago embarque ${r.embarqueCodigo} — ${r.proveedorNombre} — Fact: ${numerosFacturas}`.slice(
                      0,
                      255,
                    ),
                  }).toString()}`
                : null;
              const totalNum = Number(r.totalArs);
              const saldoNum = Number(r.saldoVivoProveedorArs);
              const partial = saldoNum > 0 && saldoNum < totalNum - 0.01;
              const saldoMatchTotal = Math.abs(saldoNum - totalNum) < 0.01;
              return (
                <TableRow key={`${r.embarqueId}-${r.proveedorId}`}>
                  <TableCell className="font-mono text-xs">
                    {r.embarqueCodigo}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{r.proveedorNombre}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.proveedorCuentaCodigo && (
                          <span className="font-mono">
                            {r.proveedorCuentaCodigo} ·{" "}
                          </span>
                        )}
                        {r.facturas
                          .map((f) => f.numero)
                          .slice(0, 4)
                          .join(", ")}
                        {r.facturas.length > 4
                          ? ` (+${r.facturas.length - 4})`
                          : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.facturas.length}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(r.totalArs)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span
                      className={
                        saldoMatchTotal
                          ? "text-rose-700 dark:text-rose-400"
                          : partial
                            ? "text-amber-700 dark:text-amber-400"
                            : ""
                      }
                    >
                      {fmtMoney(r.saldoVivoProveedorArs)}
                    </span>
                    {saldoMatchTotal && (
                      <div className="text-[10px] font-normal text-muted-foreground">
                        (sin pago registrado)
                      </div>
                    )}
                    {partial && (
                      <div className="text-[10px] font-normal text-muted-foreground">
                        (parcial)
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {fmtMoney(r.pendienteArs)}
                  </TableCell>
                  <TableCell className="text-right">
                    {href ? (
                      <Link
                        href={href}
                        className="inline-flex h-8 items-center rounded-full border border-input bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        Pagar
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        sin cuenta
                      </span>
                    )}
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
              <TableHead className="text-right">Saldo (ARS)</TableHead>
              <TableHead className="w-28 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const proveedoresActivos = r.proveedores.filter(
                (p) => p.estado === "activo",
              );
              const pagarHref = buildPagarHref(r);
              return (
                <TableRow key={r.cuentaId}>
                  <TableCell className="font-mono text-xs">
                    {r.cuentaCodigo}
                  </TableCell>
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
  const proveedoresActivos = row.proveedores.filter(
    (p) => p.estado === "activo",
  );
  const refProveedor =
    proveedoresActivos.length === 1
      ? proveedoresActivos[0].nombre
      : row.cuentaNombre;

  const params = new URLSearchParams({
    tipo: "PAGO",
    cuentaContableId: String(row.cuentaId),
    monto: row.saldo,
    descripcion: `Pago a ${refProveedor} (${row.cuentaCodigo})`,
  });
  return `/tesoreria/movimientos/nuevo?${params.toString()}`;
}
