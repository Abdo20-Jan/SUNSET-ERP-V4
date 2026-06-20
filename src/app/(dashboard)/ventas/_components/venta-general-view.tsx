import type { VentaDetalle } from "@/lib/actions/ventas";
import { fmtDate, fmtMontoPres, fmtTipoCambio } from "@/lib/format";
import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { DateBadge } from "@/components/ui/date-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  venta: VentaDetalle;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  depositosMap: Record<string, string>;
  asientoNumero: number | null;
  moneda: Moneda;
  tc: string | null;
};

// Tab "General" del detalle de venta: totales (Stats), campos y la tabla de
// ítems. Presentacional (sólo formatea con `moneda`/`tc` ya resueltos por la
// página) → server component, fuera del bundle client.
export function VentaGeneralView({
  venta,
  productosMap,
  depositosMap,
  asientoNumero,
  moneda,
  tc,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Subtotal"
          value={`${fmtMontoPres(venta.subtotal, venta.moneda, moneda, tc)} ${moneda}`}
        />
        <Stat
          label="IVA"
          value={`${fmtMontoPres(venta.iva, venta.moneda, moneda, tc)} ${moneda}`}
        />
        <Stat
          label="IIBB + Otros"
          value={`${fmtMontoPres(
            (Number(venta.iibb) + Number(venta.otros)).toFixed(2),
            venta.moneda,
            moneda,
            tc,
          )} ${moneda}`}
        />
        <Stat
          label="Total"
          value={`${fmtMontoPres(venta.total, venta.moneda, moneda, tc)} ${moneda}`}
          emphasis
        />
        {Number(venta.flete) > 0 ? (
          <Stat
            label="Flete (gasto)"
            value={`-${fmtMontoPres(venta.flete, venta.moneda, moneda, tc)} ${moneda}`}
          />
        ) : null}
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Fecha">{fmtDate(new Date(venta.fecha))}</Field>
          <Field label="Vencimiento">
            <DateBadge fecha={venta.fechaVencimiento} relative />
          </Field>
          <Field label="Tipo de cambio">
            {venta.moneda === "ARS" ? "—" : `1 USD = ${fmtTipoCambio(venta.tipoCambio)} ARS`}
          </Field>
          <Field label="Asiento contable">
            {asientoNumero != null ? (
              <span className="font-mono">Nº {asientoNumero}</span>
            ) : (
              <span className="text-muted-foreground">Sin asiento</span>
            )}
          </Field>
          {venta.notas && (
            <Field label="Notas" wide>
              {venta.notas}
            </Field>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <Table>
          <caption className="sr-only">Ítems de la venta {venta.numero}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Depósito</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">P. unit.</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {venta.items.map((it) => {
              const p = productosMap[it.productoId];
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    {p ? (
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span>{" "}
                        {p.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {it.depositoId ? (
                      (depositosMap[it.depositoId] ?? it.depositoId)
                    ) : (
                      <span className="text-muted-foreground italic">default</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{it.cantidad}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMontoPres(it.precioUnitario, venta.moneda, moneda, tc)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMontoPres(it.subtotal, venta.moneda, moneda, tc)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMontoPres(it.iva, venta.moneda, moneda, tc)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMontoPres(it.total, venta.moneda, moneda, tc)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span
          className={
            emphasis
              ? "font-mono text-xl font-semibold tabular-nums"
              : "font-mono text-base tabular-nums"
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-1 flex flex-col gap-1 md:col-span-3" : "flex flex-col gap-1"}>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}
