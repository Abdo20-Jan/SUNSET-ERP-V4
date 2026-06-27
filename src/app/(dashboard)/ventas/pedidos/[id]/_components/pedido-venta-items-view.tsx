import type { PedidoVentaDetalle } from "@/lib/actions/pedidos-venta";
import {
  calcularMargenLineaPedido,
  type MargenLineaPedido,
} from "@/lib/services/margen-pedido-linea";
import { fmtMontoPres } from "@/lib/format";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConversionResumen } from "./pedido-venta-resumen-view";
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";

/*
 * PedidoVentaItemsView (PR-019) — aba "Items / Operación" do record de Pedido.
 * Grade densa derivada SÓ de dado existente (sem schema/motor):
 *   # · Producto · Cant. solicitada · Cant. convertida · Cant. pendiente · Precio unit.
 *   · Total neto · Margen %* · Margen valor* · Estado línea.
 * Margem (% e valor) é gated por permissão (PR-011): a coluna NÃO se renderiza sem
 * `verMargen` (08_SALES_MARGIN_RULES). As colunas da OD-02 sem dado (SKU, reserva,
 * stock disp/post, descuento, IVA) ficam OMITIDAS — ver IMPLEMENTATION_NOTES_PR019.
 */
export type LineaPedidoDerivada = {
  id: number;
  codigo: string | null;
  nombre: string | null;
  solicitada: number;
  convertida: number;
  pendiente: number;
  precioUnitario: string;
  totalNeto: string;
  estadoLinea: EstadoLinea;
  margen: MargenLineaPedido | null;
};

type EstadoLinea = "Convertida" | "Parcial" | "Pendiente" | "Cancelada";

const ESTADO_LINEA_TONE: Record<EstadoLinea, string> = {
  Convertida: "text-emerald-700 dark:text-emerald-400",
  Parcial: "text-amber-700 dark:text-amber-400",
  Pendiente: "text-muted-foreground",
  Cancelada: "text-rose-700 dark:text-rose-400",
};

/** Estado de la línea derivado de la conversión (puro). */
function resolverEstadoLinea(
  solicitada: number,
  convertidaEfectiva: number,
  pedidoCancelado: boolean,
): EstadoLinea {
  if (pedidoCancelado) return "Cancelada";
  if (solicitada > 0 && convertidaEfectiva >= solicitada) return "Convertida";
  if (convertidaEfectiva > 0) return "Parcial";
  return "Pendiente";
}

/**
 * Deriva las líneas del pedido (puro). `convertidasMap` agrupa Σ ItemVenta.cantidad
 * por productoId (ventas vinculadas no canceladas); se cap-ea por línea a la cantidad
 * solicitada para que "convertida" nunca supere "solicitada" (la action de conversión
 * no tiene tracking parcial → múltiples conversiones podrían sumar de más). El margen
 * por línea sólo se calcula con `verMargen` (PR-011: no filtrar costo al cliente).
 */
export function derivarLineasPedido(args: {
  items: PedidoVentaDetalle["items"];
  productosMap: Record<string, { codigo: string; nombre: string }>;
  convertidasMap: ReadonlyMap<string, number>;
  costoMap: ReadonlyMap<string, string | null>;
  verMargen: boolean;
  pedidoCancelado: boolean;
}): LineaPedidoDerivada[] {
  return args.items.map((it) => {
    const solicitada = it.cantidad;
    const convertidaProducto = args.convertidasMap.get(it.productoId) ?? 0;
    const convertida = Math.min(convertidaProducto, solicitada);
    const pendiente = Math.max(0, solicitada - convertida);
    const p = args.productosMap[it.productoId];
    const totalNeto = (Number(it.precioUnitario) * solicitada).toFixed(2);
    const margen = args.verMargen
      ? calcularMargenLineaPedido({
          precioUnitario: it.precioUnitario,
          cantidad: solicitada,
          costoPromedio: args.costoMap.get(it.productoId) ?? null,
        })
      : null;
    return {
      id: it.id,
      codigo: p?.codigo ?? null,
      nombre: p?.nombre ?? null,
      solicitada,
      convertida,
      pendiente,
      precioUnitario: it.precioUnitario,
      totalNeto,
      estadoLinea: resolverEstadoLinea(solicitada, convertida, args.pedidoCancelado),
      margen,
    };
  });
}

/** Resume la conversión total a partir de las líneas derivadas (puro). */
export function resumirConversion(
  lineas: readonly LineaPedidoDerivada[],
  ventas: ConversionResumen["ventas"],
): ConversionResumen {
  let solicitadaTotal = 0;
  let convertidaTotal = 0;
  for (const l of lineas) {
    solicitadaTotal += l.solicitada;
    convertidaTotal += l.convertida;
  }
  const pendienteTotal = Math.max(0, solicitadaTotal - convertidaTotal);
  const pct = solicitadaTotal > 0 ? (convertidaTotal / solicitadaTotal) * 100 : 0;
  return { solicitadaTotal, convertidaTotal, pendienteTotal, pct, ventas };
}

type Props = {
  lineas: LineaPedidoDerivada[];
  pedidoMoneda: Moneda;
  moneda: Moneda;
  tc: string | null;
  verMargen: boolean;
  numero: string;
};

function MargenCells({
  margen,
  pedidoMoneda,
  moneda,
  tc,
}: {
  margen: MargenLineaPedido | null;
  pedidoMoneda: Moneda;
  moneda: Moneda;
  tc: string | null;
}) {
  if (!margen) {
    return (
      <>
        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">—</TableCell>
        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">—</TableCell>
      </>
    );
  }
  const positivo = Number(margen.margenValor) >= 0;
  const tone = positivo
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  return (
    <>
      <TableCell className={`text-right font-mono tabular-nums ${tone}`}>
        {margen.margenPct}%
      </TableCell>
      <TableCell className={`text-right font-mono tabular-nums ${tone}`}>
        {fmtMontoPres(margen.margenValor, pedidoMoneda, moneda, tc)}
      </TableCell>
    </>
  );
}

function LineaRow({
  index,
  linea,
  pedidoMoneda,
  moneda,
  tc,
  verMargen,
}: {
  index: number;
  linea: LineaPedidoDerivada;
  pedidoMoneda: Moneda;
  moneda: Moneda;
  tc: string | null;
  verMargen: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono tabular-nums text-muted-foreground">{index + 1}</TableCell>
      <TableCell>
        {linea.codigo ? (
          <span>
            <span className="font-mono text-xs text-muted-foreground">{linea.codigo}</span>{" "}
            {linea.nombre}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{linea.solicitada}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{linea.convertida}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{linea.pendiente}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(linea.precioUnitario, pedidoMoneda, moneda, tc)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(linea.totalNeto, pedidoMoneda, moneda, tc)}
      </TableCell>
      {verMargen && (
        <MargenCells margen={linea.margen} pedidoMoneda={pedidoMoneda} moneda={moneda} tc={tc} />
      )}
      <TableCell className={ESTADO_LINEA_TONE[linea.estadoLinea]}>{linea.estadoLinea}</TableCell>
    </TableRow>
  );
}

export function PedidoVentaItemsView({
  lineas,
  pedidoMoneda,
  moneda,
  tc,
  verMargen,
  numero,
}: Props) {
  return (
    <Card className="py-0">
      <Table>
        <caption className="sr-only">Ítems del pedido {numero}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Cant. solicitada</TableHead>
            <TableHead className="text-right">Cant. convertida</TableHead>
            <TableHead className="text-right">Cant. pendiente</TableHead>
            <TableHead className="text-right">Precio unit.</TableHead>
            <TableHead className="text-right">Total neto</TableHead>
            {verMargen && (
              <>
                <TableHead className="text-right">Margen %</TableHead>
                <TableHead className="text-right">Margen valor</TableHead>
              </>
            )}
            <TableHead>Estado línea</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineas.map((linea, index) => (
            <LineaRow
              key={linea.id}
              index={index}
              linea={linea}
              pedidoMoneda={pedidoMoneda}
              moneda={moneda}
              tc={tc}
              verMargen={verMargen}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
