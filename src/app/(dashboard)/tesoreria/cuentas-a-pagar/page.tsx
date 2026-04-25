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
  type CxPRow,
} from "@/lib/services/cuentas-a-pagar";

export const dynamic = "force-dynamic";

export default async function CuentasAPagarPage() {
  const data = await getCuentasAPagar();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
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

      <Section
        title="Aduana / Nacionalización"
        subtitle="Tributos por pagar a Aduana y AFIP por embarques importados (cuenta 2.1.5.x)."
        rows={data.aduana}
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
  const params = new URLSearchParams({
    tipo: "PAGO",
    cuentaContableId: String(row.cuentaId),
    descripcion: `Pago ${row.cuentaCodigo} ${row.cuentaNombre}`,
  });
  return `/tesoreria/movimientos/nuevo?${params.toString()}`;
}
