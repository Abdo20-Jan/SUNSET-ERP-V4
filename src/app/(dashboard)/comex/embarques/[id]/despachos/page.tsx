import Link from "next/link";
import { notFound } from "next/navigation";

import {
  obtenerEmbarquePorId,
} from "@/lib/actions/embarques";
import {
  listarDespachosDeEmbarque,
} from "@/lib/actions/despachos";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { fmtMoney } from "@/lib/format";

import { DespachoActions } from "./_components/despacho-actions";
import { CrearDespachoForm } from "./_components/crear-despacho-form";

type PageParams = Promise<{ id: string }>;

export default async function DespachosEmbarquePage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;
  const embarque = await obtenerEmbarquePorId(id);
  if (!embarque) notFound();

  const [despachos, productos, facturasDespachoLibres, depositos] =
    await Promise.all([
      listarDespachosDeEmbarque(id),
      db.producto.findMany({
        where: { id: { in: embarque.items.map((i) => i.productoId) } },
        select: { id: true, codigo: true, nombre: true },
      }),
      db.embarqueCosto.findMany({
        where: {
          embarqueId: id,
          momento: "DESPACHO",
          despachoId: null,
        },
        include: {
          proveedor: { select: { nombre: true } },
          lineas: { select: { subtotal: true } },
        },
        orderBy: { id: "asc" },
      }),
      db.deposito.findMany({
        where: { activo: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
    ]);

  const productosMap = new Map(productos.map((p) => [p.id, p]));

  // Calcular cantidades despachadas por ItemEmbarque (excluyendo ANULADOS)
  const despachosNoAnulados = await db.despacho.findMany({
    where: { embarqueId: id, estado: { not: "ANULADO" } },
    include: { items: { select: { itemEmbarqueId: true, cantidad: true } } },
  });
  const yaDespachadoMap = new Map<number, number>();
  for (const d of despachosNoAnulados) {
    for (const i of d.items) {
      yaDespachadoMap.set(
        i.itemEmbarqueId,
        (yaDespachadoMap.get(i.itemEmbarqueId) ?? 0) + i.cantidad,
      );
    }
  }

  const itemsDisponibles = embarque.items
    .map((it) => {
      const producto = productosMap.get(it.productoId);
      const yaDespachado = yaDespachadoMap.get(it.id) ?? 0;
      const remanente = it.cantidad - yaDespachado;
      return {
        itemEmbarqueId: it.id,
        productoCodigo: producto?.codigo ?? "?",
        productoNombre: producto?.nombre ?? "?",
        cantidadTotal: it.cantidad,
        yaDespachado,
        remanente,
      };
    })
    .filter((it) => it.remanente > 0);

  const facturasOptions = facturasDespachoLibres.map((f) => {
    const tc = Number(f.tipoCambio);
    const subtotal = f.lineas.reduce(
      (s, l) => s + Number(l.subtotal) * tc,
      0,
    );
    const total =
      subtotal +
      Number(f.iva) * tc +
      Number(f.iibb) * tc +
      Number(f.otros) * tc;
    return {
      id: f.id,
      label: `${f.proveedor.nombre}${f.facturaNumero ? ` Fact.${f.facturaNumero}` : ""}`,
      totalArs: total,
    };
  });

  const tieneZP = !!embarque.asientoZonaPrimaria;
  const tieneCierre = !!embarque.asiento;
  const puedeCrear = tieneZP && !tieneCierre;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={`Despachos parciales — ${embarque.codigo}`}
        description={
          tieneCierre
            ? "Embarque cerrado en flujo monolítico — no admite despachos parciales."
            : !tieneZP
              ? "Confirme zona primaria primero."
              : `Mercadería en tránsito disponible para despachar parcialmente.`
        }
        actions={
          <Link href={`/comex/embarques/${id}`}>
            <Button variant="outline" size="sm">
              ← Volver al embarque
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Despachos del embarque</CardTitle>
          <CardDescription>
            {despachos.length === 0
              ? "Aún no se generaron despachos."
              : `${despachos.length} despacho${despachos.length === 1 ? "" : "s"} registrado${despachos.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {despachos.length > 0 && (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left">Código</th>
                    <th className="px-2.5 py-1.5 text-left">Fecha</th>
                    <th className="px-2.5 py-1.5 text-left">Nº OM</th>
                    <th className="px-2.5 py-1.5 text-right">Ítems</th>
                    <th className="px-2.5 py-1.5 text-right">Facturas</th>
                    <th className="px-2.5 py-1.5 text-left">Estado</th>
                    <th className="px-2.5 py-1.5 text-left">Asiento</th>
                    <th className="px-2.5 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {despachos.map((d) => (
                    <tr key={d.id}>
                      <td className="px-2.5 py-1.5 font-mono">{d.codigo}</td>
                      <td className="px-2.5 py-1.5">
                        {new Date(d.fecha).toLocaleDateString("es-AR")}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[12px]">
                        {d.numeroOM ?? "—"}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">{d.itemsCount}</td>
                      <td className="px-2.5 py-1.5 text-right">{d.facturasCount}</td>
                      <td className="px-2.5 py-1.5">
                        <Badge
                          variant={
                            d.estado === "CONTABILIZADO"
                              ? "default"
                              : d.estado === "ANULADO"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {d.estado}
                        </Badge>
                      </td>
                      <td className="px-2.5 py-1.5">
                        {d.asiento ? (
                          <Link
                            href={`/contabilidad/asientos/${d.asiento.id}`}
                            className="text-[12px] underline-offset-2 hover:underline"
                          >
                            #{d.asiento.numero}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <DespachoActions
                          despachoId={d.id}
                          estado={d.estado}
                          codigo={d.codigo}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {puedeCrear && itemsDisponibles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Nuevo despacho parcial</CardTitle>
            <CardDescription>
              Seleccioná los ítems a nacionalizar + tributos del despacho +
              facturas DESPACHO linkadas. Al contabilizar genera asiento +
              ingreso de stock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CrearDespachoForm
              embarqueId={id}
              embarqueCodigo={embarque.codigo}
              embarqueMoneda={embarque.moneda}
              embarqueTipoCambio={embarque.tipoCambio}
              depositoDestinoId={embarque.depositoDestinoId}
              depositos={depositos}
              items={itemsDisponibles}
              facturas={facturasOptions}
            />
            {!embarque.depositoDestinoId && (
              <p className="mt-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-[12px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
                Definí el depósito destino del embarque antes de contabilizar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {puedeCrear && itemsDisponibles.length === 0 && despachos.length > 0 && (
        <Card>
          <CardContent className="text-[13px] text-muted-foreground">
            Toda la mercadería ya fue despachada o asignada a despachos en
            BORRADOR/CONTABILIZADO.
          </CardContent>
        </Card>
      )}

      {/* Hint footer (totals etc) */}
      <div className="text-[11px] text-muted-foreground">
        <p>
          FOB total: {embarque.moneda} {fmtMoney(embarque.fobTotal)} · TC
          embarque: {Number(embarque.tipoCambio).toFixed(2)}
        </p>
      </div>
    </div>
  );
}
