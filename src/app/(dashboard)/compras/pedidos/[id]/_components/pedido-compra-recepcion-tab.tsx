import type { RecepcionLinea } from "@/lib/services/pedido-compra-recepcion";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/*
 * PedidoCompraRecepcionTab (PR-029 · COMP-02 · OD-11) — aba "Recepción" do record
 * da OC. Decisão do dono OD-11 (2026-06-23): Recepción es PESTAÑA de la OC, nunca
 * ruta propia. 100% READ-ONLY y DERIVADA — no existe modelo Recepcion ni action
 * que escriba RECIBIDA; esta aba NO ofrece transiciones ni estados inventados.
 * DOS TRILHAS separadas (nunca sumadas): comercial (Facturado) × física
 * (Ingresado a stock / Nacionalizado). Derivación en
 * `lib/services/pedido-compra-recepcion.ts`.
 */
type Props = {
  lineas: RecepcionLinea[];
  productosMap: Record<string, { codigo: string; nombre: string }>;
};

function ProductoCell({
  linea,
  productosMap,
}: {
  linea: RecepcionLinea;
  productosMap: Props["productosMap"];
}) {
  const p = productosMap[linea.productoId];
  return (
    <TableCell>
      <span className="flex flex-col">
        <span>
          {p ? (
            <>
              <span className="font-mono text-xs text-muted-foreground">{p.codigo}</span> {p.nombre}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        {linea.pedida === 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            Fuera de pedido (agregado en la factura/embarque)
          </span>
        )}
      </span>
    </TableCell>
  );
}

function FacturadaCell({ linea }: { linea: RecepcionLinea }) {
  const excede = linea.facturadaBruta > linea.facturada;
  return (
    <TableCell className="text-right font-mono tabular-nums">
      {linea.facturada}
      {excede && (
        <span
          className="ml-1 text-xs text-amber-700 dark:text-amber-400"
          title={`Facturado bruto ${linea.facturadaBruta} un — excede lo pedido`}
        >
          ({linea.facturadaBruta})
        </span>
      )}
    </TableCell>
  );
}

export function PedidoCompraRecepcionTab({ lineas, productosMap }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Card className="py-0">
        <Table>
          <caption className="sr-only">Recepción derivada del pedido</caption>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>Producto</TableHead>
              <TableHead rowSpan={2} className="text-right">
                Cant. pedida
              </TableHead>
              <TableHead colSpan={2} className="border-l text-center">
                Comercial
              </TableHead>
              <TableHead colSpan={3} className="border-l text-center">
                Física
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="border-l text-right">Facturada</TableHead>
              <TableHead className="text-right">Pendiente fact.</TableHead>
              <TableHead className="border-l text-right">Ingresada a stock</TableHead>
              <TableHead className="text-right">Embarcada</TableHead>
              <TableHead className="text-right">Nacionalizada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineas.map((linea) => (
              <TableRow key={linea.productoId}>
                <ProductoCell linea={linea} productosMap={productosMap} />
                <TableCell className="text-right font-mono tabular-nums">
                  {linea.pedida > 0 ? linea.pedida : "—"}
                </TableCell>
                <FacturadaCell linea={linea} />
                <TableCell className="text-right font-mono tabular-nums">
                  {linea.pendienteFacturar}
                </TableCell>
                <TableCell className="border-l text-right font-mono tabular-nums">
                  {linea.ingresadaStock}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {linea.embarcada}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {linea.nacionalizada}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card className="p-4">
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
          <li>
            <span className="font-medium">Comercial ≠ física:</span> «Facturada» cuenta facturas de
            compra vinculadas emitidas; «Ingresada a stock» cuenta los movimientos de stock reales
            (sólo líneas que capitalizan estoque — servicios/gastos no generan movimiento).
          </li>
          <li>
            «Nacionalizada» cuenta despachos CONTABILIZADO de embarques vinculados (o el cierre
            monolítico legacy); «Embarcada» es mercadería ya despachada al exterior, aún no
            disponible.
          </li>
          <li>
            Derivado por producto (no hay vínculo ítem-a-ítem); compras/embarques no vinculados al
            pedido no se incluyen. No existe un flujo de recepción con conferencia/remito — esta
            vista deriva de los documentos existentes (OD-11).
          </li>
        </ul>
      </Card>
    </div>
  );
}
