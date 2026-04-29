"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Cuenta = {
  id: string;
  banco: string;
  moneda: "ARS" | "USD";
  numero: string | null;
};

export function CuentaBancariaSelect({
  cuentas,
  selectedId,
  desde,
  hasta,
}: {
  cuentas: Cuenta[];
  selectedId: string | null;
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const handleChange = (value: string | null) => {
    if (!value) return;
    const params = new URLSearchParams();
    params.set("cuenta", value);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    startTransition(() => {
      router.push(`/tesoreria/extracto?${params.toString()}`);
    });
  };

  return (
    <Select value={selectedId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Seleccione cuenta">
          {(value) => {
            const c = cuentas.find((x) => x.id === value);
            return c
              ? `${c.banco} · ${c.numero ?? "—"} · ${c.moneda}`
              : "Seleccione cuenta";
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {cuentas.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.banco} · {c.numero ?? "—"} · {c.moneda}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
