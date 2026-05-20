"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type EmbarqueTabKey = "transito" | "porto" | "finalizados" | "borrador";

type Counts = Record<EmbarqueTabKey, number>;

export function EmbarquesTabs({ current, counts }: { current: EmbarqueTabKey; counts: Counts }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setTab(v: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", v);
    params.delete("page");
    router.replace(`/comex/embarques?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={current} onValueChange={(v) => setTab(String(v))}>
      <TabsList variant="line" className="flex-wrap">
        <TabsTrigger value="transito">
          En tránsito
          <Badge variant="outline" className="ml-1">
            {counts.transito}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="porto">
          En puerto
          <Badge variant="outline" className="ml-1">
            {counts.porto}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="finalizados">
          Finalizados
          <Badge variant="outline" className="ml-1">
            {counts.finalizados}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="borrador">
          Borradores
          <Badge variant="outline" className="ml-1">
            {counts.borrador}
          </Badge>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
