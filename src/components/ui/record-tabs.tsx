"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type RecordTab = { value: string; label: string; count?: number };

// Subtabs de un record-shell, manejadas por la URL (search param `tab`). El
// contenido de cada tab lo renderiza la página (server) según el param activo —
// este componente sólo cambia el param. Espeja el patrón URL-driven de
// embarques-tabs.tsx (sin nuqs; sin TabsContent).
export function RecordTabs({
  tabs,
  activeValue,
  paramKey = "tab",
}: {
  tabs: RecordTab[];
  activeValue: string;
  paramKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onValueChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(paramKey, value);
    next.delete("page");
    const qs = next.toString();
    router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={activeValue} onValueChange={(v) => onValueChange(String(v))}>
      <TabsList variant="line" className="flex-wrap">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            {tab.count != null && (
              <Badge variant="outline" className="ml-1">
                {tab.count}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
