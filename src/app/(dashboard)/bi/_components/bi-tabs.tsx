"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";

export type BiTabId =
  | "resumen"
  | "ventas"
  | "compras"
  | "stock"
  | "tesoreria"
  | "giro"
  | "liquidez"
  | "rentabilidad"
  | "fiscal";

const TABS: { id: BiTabId; label: string; emoji: string }[] = [
  { id: "resumen", label: "Resumen", emoji: "📊" },
  { id: "ventas", label: "Ventas", emoji: "🛒" },
  { id: "compras", label: "Compras", emoji: "🚢" },
  { id: "stock", label: "Stock", emoji: "📦" },
  { id: "tesoreria", label: "Tesorería", emoji: "💳" },
  { id: "giro", label: "Giro", emoji: "🔄" },
  { id: "liquidez", label: "Liquidez", emoji: "💧" },
  { id: "rentabilidad", label: "Rentabilidad", emoji: "📈" },
  { id: "fiscal", label: "Fiscal", emoji: "🧾" },
];

export function BiTabs({ current }: { current: BiTabId }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const onClick = (id: BiTabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 overflow-x-auto rounded-md border bg-muted/30 p-1"
    >
      {TABS.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={isPending}
            onClick={() => onClick(t.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <span className="text-[13px] leading-none">{t.emoji}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
