import type { PedidoCompraDetalle } from "@/lib/actions/pedidos-compra";
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
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";

/*
 * PedidoCompraItemsView (PR-029) — aba "Items / Operación" do record da OC.
 * Grade densa derivada SÓ de dado existente (sem schema/motor):
 *   # · Producto · Cant. pedida · Cant. facturada · Cant. pendiente · Precio unit.
 *   · Total neto · Estado línea.
 * Espejo de `pedido-venta-items-view.tsx` (PR-019) con "facturada" en lugar de
 * "convertida" (Compras vinculadas EMITIDA/RECIBIDA) y sin columnas de margen
 * (la OC no modela margen). Las columnas COMP-01 sin dato (reserva, depósito,
 * IVA) quedan OMITIDAS — ver IMPLEMENTATION_NOTES_PR029.
 */
export type LineaPedidoCompraDerivada = {
  id: number;
  codigo: string | null;
  nombre: string | null;
  pedida: number;
  facturada: number;
  pendiente: number;
  precioUnitario: string;
  totalNeto: string;
  estadoLinea: EstadoLinea;
};

type EstadoLinea = "Facturada" | "Parcial" | "Pendiente" | "Cancelada";

const ESTADO_LINEA_TONE: Record<EstadoLinea, string> = {
  Facturada: "text-emerald-700 dark:text-emerald-400",
  Parcial: "text-amber-700 dark:text-amber-400",
  Pendiente: "text-muted-foreground",
  Cancelada: "text-rose-700 dark:text-rose-400",
};

/** Estado de la línea derivado de la facturación (puro). */
function resolverEstadoLinea(
  pedida: number,
  facturadaEfectiva: number,
  pedidoCancelado: boolean,
): EstadoLinea {
  if (pedidoCancelado) return "Cancelada";
  if (pedida > 0 && facturadaEfectiva >= pedida) return "Facturada";
  if (facturadaEfectiva > 0) return "Parcial";
  return "Pendiente";
}

/**
 * Deriva las líneas de la OC (puro). `facturadasMap` agrupa Σ ItemCompra.cantidad
 * por productoId (compras vinculadas EMITIDA/RECIBIDA); se cap-ea por línea a la
 * cantidad pedida para que "facturada" nunca supere "pedida" (la conversión
 * OC→Compra no tiene tracking parcial → múltiples conversiones podrían sumar de
 * más). Espejo de `derivarLineasPedido` (PR-019).
 */
export function derivarLineasPedidoCompra(args: {
  items: PedidoCompraDetalle["items"];
  productosMap: Record<string, { codigo: string; nombre: string }>;
  facturadasMap: ReadonlyMap<string, number>;
  pedidoCancelado: boolean;
}): LineaPedidoCompraDerivada[] {
  return args.items.map((it) => {
    const pedida = it.cantidad;
    const facturadaProducto = args.facturadasMap.get(it.productoId) ?? 0;
    const facturada = Math.min(facturadaProducto, pedida);
    const pendiente = Math.max(0, pedida - facturada);
    const p = args.productosMap[it.productoId];
    const totalNeto = (Number(it.precioUnitario) * pedida).toFixed(2);
    return {
      id: it.id,
      codigo: p?.codigo ?? null,
      nombre: p?.nombre ?? null,
      pedida,
      facturada,
      pendiente,
      precioUnitario: it.precioUnitario,
      totalNeto,
      estadoLinea: resolverEstadoLinea(pedida, facturada, args.pedidoCancelado),
    };
  });
}

export type FacturacionResumen = {
  pedidaTotal: number;
  facturadaTotal: number;
  pendienteTotal: number;
  /** % facturado (0-100, 1 decimal). */
  pct: number;
  compras: Array<{ id: string; numero: string; estado: string }>;
};

/** Resume la facturación total a partir de las líneas derivadas (puro). */
export function resumirFacturacion(
  lineas: readonly LineaPedidoCompraDerivada[],
  compras: FacturacionResumen["compras"],
): FacturacionResumen {
  let pedidaTotal = 0;
  let facturadaTotal = 0;
  for (const l of lineas) {
    pedidaTotal += l.pedida;
    facturadaTotal += l.facturada;
  }
  const pendienteTotal = Math.max(0, pedidaTotal - facturadaTotal);
  const pct = pedidaTotal > 0 ? (facturadaTotal / pedidaTotal) * 100 : 0;
  return { pedidaTotal, facturadaTotal, pendienteTotal, pct, compras };
}

type Props = {
  lineas: LineaPedidoCompraDerivada[];
  pedidoMoneda: Moneda;
  moneda: Moneda;
  tc: string | null;
  numero: string;
};

function LineaRow({
  index,
  linea,
  pedidoMoneda,
  moneda,
  tc,
}: {
  index: number;
  linea: LineaPedidoCompraDerivada;
  pedidoMoneda: Moneda;
  moneda: Moneda;
  tc: string | null;
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
      <TableCell className="text-right font-mono tabular-nums">{linea.pedida}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{linea.facturada}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{linea.pendiente}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(linea.precioUnitario, pedidoMoneda, moneda, tc)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(linea.totalNeto, pedidoMoneda, moneda, tc)}
      </TableCell>
      <TableCell className={ESTADO_LINEA_TONE[linea.estadoLinea]}>{linea.estadoLinea}</TableCell>
    </TableRow>
  );
}

export function PedidoCompraItemsView({ lineas, pedidoMoneda, moneda, tc, numero }: Props) {
  return (
    <Card className="py-0">
      <Table>
        <caption className="sr-only">Ítems del pedido {numero}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Cant. pedida</TableHead>
            <TableHead className="text-right">Cant. facturada</TableHead>
            <TableHead className="text-right">Cant. pendiente</TableHead>
            <TableHead className="text-right">Precio unit.</TableHead>
            <TableHead className="text-right">Total neto</TableHead>
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
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
