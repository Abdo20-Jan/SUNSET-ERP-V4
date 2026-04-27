"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CuentaCombobox, type CuentaOption } from "@/components/cuenta-combobox";
import { Label } from "@/components/ui/label";

type Props = {
  cuentas: CuentaOption[];
  selectedCuentaId: number | null;
};

export function MayorFilters({ cuentas, selectedCuentaId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const onCuentaChange = (id: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("cuentaId", String(id));
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-80 flex-1 flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Cuenta analítica</Label>
        <CuentaCombobox
          value={selectedCuentaId}
          onChange={onCuentaChange}
          cuentas={cuentas}
        />
      </div>
    </div>
  );
}
