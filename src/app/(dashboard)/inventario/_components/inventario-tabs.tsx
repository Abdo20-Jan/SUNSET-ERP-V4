"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EnProduccionFila, EnTransitoFila } from "@/lib/actions/inventario";

import { EnProduccionTable } from "./en-produccion-table";
import { EnTransitoTable } from "./en-transito-table";
import { InventarioMatrix } from "./inventario-matrix";

type Deposito = { id: string; nombre: string };

type StockPorDep = {
  depositoId: string;
  cantidadFisica: number;
  cantidadReservada: number;
};

type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  stockActual: number;
  stockPorDeposito: StockPorDep[];
};

export function InventarioTabs({
  productos,
  depositos,
  enTransito,
  enProduccion,
  initialTab,
}: {
  productos: Producto[];
  depositos: Deposito[];
  enTransito: EnTransitoFila[];
  enProduccion: EnProduccionFila[];
  initialTab: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const stockTotalPorDep = new Map<string, number>();
  for (const p of productos) {
    for (const s of p.stockPorDeposito) {
      stockTotalPorDep.set(
        s.depositoId,
        (stockTotalPorDep.get(s.depositoId) ?? 0) + s.cantidadFisica,
      );
    }
  }

  const countTransito = enTransito.reduce((a, f) => a + f.cantidad, 0);
  const countProduccion = enProduccion.reduce((a, f) => a + f.cantidadEnProduccion, 0);

  function setTab(value: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.replace(`/inventario?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={initialTab} onValueChange={(v) => setTab(String(v))}>
      <TabsList variant="line" className="flex-wrap">
        {depositos.map((d) => (
          <TabsTrigger key={d.id} value={d.id}>
            {d.nombre}
            <Badge variant="outline" className="ml-1">
              {stockTotalPorDep.get(d.id) ?? 0}
            </Badge>
          </TabsTrigger>
        ))}
        <TabsTrigger value="transito">
          En tránsito
          <Badge variant="outline" className="ml-1">
            {countTransito}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="produccion">
          En producción
          <Badge variant="outline" className="ml-1">
            {countProduccion}
          </Badge>
        </TabsTrigger>
      </TabsList>

      {depositos.map((d) => (
        <TabsContent key={d.id} value={d.id}>
          <InventarioMatrix productos={productos} depositos={[d]} />
        </TabsContent>
      ))}
      <TabsContent value="transito">
        <EnTransitoTable filas={enTransito} />
      </TabsContent>
      <TabsContent value="produccion">
        <EnProduccionTable filas={enProduccion} />
      </TabsContent>
    </Tabs>
  );
}
