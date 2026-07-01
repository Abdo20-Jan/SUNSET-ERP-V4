"use client";

/**
 * Worklist de cuentas bancarias sobre EnterpriseDataGrid (TES-01 · PR-025a).
 *
 * UI-only: monta el grid (busca rápida + chips + densidad) sobre la proyección
 * read-only `listarCuentasBancariasWorklist`. El alta abre la
 * `NuevaCuentaWorkWindow` (FWW, sin drawer lateral) que HOSPEDA el mismo form y
 * llama `crearCuentaBancariaAction` con payload byte-idéntico. La columna Saldo
 * ya viene gateada del server (`saldo: null` sin `VER_SALDO`).
 */

import { useMemo } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { Moneda } from "@/generated/prisma/client";
import type { CuentaContableOption } from "@/lib/actions/cuentas-bancarias";
import type { CuentaBancariaWorklistRow } from "@/lib/services/cuenta-bancaria-worklist";

import { buildCuentasColumns } from "./cuentas-columns";
import { NuevaCuentaButton } from "./nueva-cuenta-work-window";

type Props = {
  rows: CuentaBancariaWorklistRow[];
  cuentasContables: CuentaContableOption[];
  moneda: Moneda;
  tc: string | null;
  verSaldo: boolean;
};

const TIPO_OPTIONS = [
  { value: "CUENTA_CORRIENTE", label: "Cuenta Corriente" },
  { value: "CAJA_AHORRO", label: "Caja de Ahorro" },
  { value: "CAJA_CHICA", label: "Caja Chica" },
];

const MONEDA_OPTIONS = [
  { value: "ARS", label: "ARS" },
  { value: "USD", label: "USD" },
];

export function CuentasWorklist({ rows, cuentasContables, moneda, tc, verSaldo }: Props) {
  const columns = useMemo(
    () => buildCuentasColumns({ verSaldo, moneda, tc }),
    [verSaldo, moneda, tc],
  );

  return (
    <EnterpriseDataGrid
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      quickSearch={{
        placeholder: "Buscar por banco, número, alias o cuenta contable…",
        keys: ["banco", "numero", "alias", "cuentaContableCodigo", "cuentaContableNombre"],
      }}
      filters={[
        { columnId: "tipo", label: "Tipo", options: TIPO_OPTIONS },
        { columnId: "moneda", label: "Moneda", options: MONEDA_OPTIONS },
      ]}
      exportSurface={false}
      primaryAction={<NuevaCuentaButton cuentasContables={cuentasContables} />}
      emptyMessage="No hay cuentas bancarias cargadas."
      emptyFilteredMessage="No hay cuentas para los filtros seleccionados."
    />
  );
}
