"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Moneda } from "@/generated/prisma/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  desde: string; // "YYYY-MM"
  hasta: string;
  moneda: Moneda;
};

const MES_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Oct",
  "Nov",
  "Dic",
];

function formatMesLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number.parseInt(m ?? "1", 10) - 1;
  const label = MES_LABELS[idx] ?? m;
  return `${label}/${(y ?? "").slice(-2)}`;
}

function buildMesOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // -18 ... +18 months inclusive
  for (let i = -18; i <= 18; i++) {
    const d = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1),
    );
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
  }
  return out;
}

export function FlujoFilters({ desde, hasta, moneda }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const push = (next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    push(next);
  };

  const mesOptions = buildMesOptions();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Desde</Label>
        <Select value={desde} onValueChange={(v) => v && setParam("desde", v)}>
          <SelectTrigger className="min-w-32">
            <SelectValue>{(v) => formatMesLabel(v as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {mesOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {formatMesLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Hasta</Label>
        <Select value={hasta} onValueChange={(v) => v && setParam("hasta", v)}>
          <SelectTrigger className="min-w-32">
            <SelectValue>{(v) => formatMesLabel(v as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {mesOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {formatMesLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Moneda</Label>
        <Select
          value={moneda}
          onValueChange={(v) => v && setParam("moneda", v)}
        >
          <SelectTrigger className="min-w-24">
            <SelectValue>{(v) => v as string}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export { formatMesLabel };
